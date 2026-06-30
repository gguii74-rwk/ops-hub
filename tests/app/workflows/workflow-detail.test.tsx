// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const detailData = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const can = vi.hoisted(() => ({ generate: false, send: false }));
const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: detailData.current, isLoading: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}));
vi.mock("@/lib/auth/permissions-client", () => ({
  useCan: (_r: string, a: string) => (a === "generate" ? can.generate : a === "send" ? can.send : false),
}));
vi.mock("@/app/(app)/workflows/[id]/send-modal", () => ({
  SendModal: (p: { step: number }) => <div data-testid="send-modal">step {p.step}</div>,
}));

import { WorkflowDetail } from "@/app/(app)/workflows/[id]/workflow-detail";

function baseDetail(over: Record<string, unknown> = {}) {
  return { id: "t1", kind: "BILLING", typeName: "대금청구", scheduledAt: "2026-02-09T15:00:00.000Z", status: "PENDING", files: [], mailDeliveries: [], timeline: [], ...over };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); can.generate = false; can.send = false; invalidate.mockClear(); });

describe("WorkflowDetail 액션 슬롯(BILLING)", () => {
  it("PENDING + generate 권한 → '문서 생성' click 시 generate POST", async () => {
    can.generate = true;
    detailData.current = baseDetail({ status: "PENDING" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "문서 생성" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/workflows/t1/generate", expect.objectContaining({ method: "POST" })));
  });

  it("generate 권한 없으면 '문서 생성' 미노출", () => {
    detailData.current = baseDetail({ status: "PENDING" });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.queryByRole("button", { name: "문서 생성" })).toBeNull();
  });

  it("GENERATED + send → 1단계 발송·ZIP·개별 다운로드, 재생성 없음(D10)", () => {
    can.send = true;
    detailData.current = baseDetail({
      status: "GENERATED",
      files: [{ id: "f1", displayName: "a.hwpx", mimeType: null, sizeBytes: 2048, createdAt: "2026-02-09T15:00:00.000Z" }],
    });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.getByRole("button", { name: "1단계 발송" })).toBeTruthy();
    expect(screen.getByText("전체 다운로드(ZIP)").closest("a")!.getAttribute("href")).toBe("/api/workflows/t1/download");
    expect(screen.queryByRole("button", { name: "문서 생성" })).toBeNull(); // 재생성 없음
    expect(screen.getByText("a.hwpx").closest("a")!.getAttribute("href")).toBe("/api/workflows/t1/files/f1");
  });

  it("GENERATED + send → 1단계 발송 클릭 시 SendModal(step 1)", () => {
    can.send = true;
    detailData.current = baseDetail({ status: "GENERATED" });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "1단계 발송" }));
    expect(screen.getByTestId("send-modal").textContent).toContain("step 1");
  });

  it("GENERATED인데 send 권한 없으면 발송 버튼 미노출", () => {
    detailData.current = baseDetail({ status: "GENERATED" });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.queryByRole("button", { name: "1단계 발송" })).toBeNull();
  });

  it("SENT + send → 2단계 발송·ZIP·개별 다운로드", () => {
    can.send = true;
    detailData.current = baseDetail({
      status: "SENT",
      files: [{ id: "f1", displayName: "a.hwpx", mimeType: null, sizeBytes: 2048, createdAt: "2026-02-09T15:00:00.000Z" }],
    });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.getByRole("button", { name: "2단계 발송" })).toBeTruthy();
    expect(screen.getByText("전체 다운로드(ZIP)").closest("a")!.getAttribute("href")).toBe("/api/workflows/t1/download");
    expect(screen.getByText("a.hwpx").closest("a")!.getAttribute("href")).toBe("/api/workflows/t1/files/f1");
  });

  it("PENDING은 파일이 있어도 개별·ZIP 다운로드 없음(plain text)", () => {
    detailData.current = baseDetail({
      status: "PENDING",
      files: [{ id: "f1", displayName: "a.hwpx", mimeType: null, sizeBytes: 2048, createdAt: "2026-02-09T15:00:00.000Z" }],
    });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.queryByText("전체 다운로드(ZIP)")).toBeNull();
    expect(screen.getByText("a.hwpx").closest("a")).toBeNull(); // plain text, 링크 아님
  });

  it("CANCELLED은 파일이 있어도 개별 다운로드 링크 없음(SC-10 회귀가드)", () => {
    detailData.current = baseDetail({
      status: "CANCELLED",
      files: [{ id: "f1", displayName: "a.hwpx", mimeType: null, sizeBytes: 2048, createdAt: "2026-02-09T15:00:00.000Z" }],
    });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.queryByText("전체 다운로드(ZIP)")).toBeNull();
    expect(screen.getByText("a.hwpx").closest("a")).toBeNull(); // plain text, 링크 아님
  });

  it("HQ_REQUESTED → 후속 단계 안내, 발송 버튼 없음", () => {
    can.send = true;
    detailData.current = baseDetail({ status: "HQ_REQUESTED", files: [{ id: "f1", displayName: "a.hwpx", mimeType: null, sizeBytes: 1, createdAt: "x" }] });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.getByText(/최종발송.*후속/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /발송/ })).toBeNull();
  });

  it("BILLING 아닌 kind는 액션 슬롯 비노출", () => {
    can.send = true; can.generate = true;
    detailData.current = baseDetail({ kind: "WEEKLY_REPORT", status: "PENDING" });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.queryByRole("button", { name: "문서 생성" })).toBeNull();
  });
});
