// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const q = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  isError: false,
  isLoading: false,
  lastQueryFn: null as null | (() => Promise<unknown>),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryFn: () => Promise<unknown> }) => {
    q.lastQueryFn = opts.queryFn;
    return { data: q.isError ? undefined : q.items, isError: q.isError, isLoading: q.isLoading };
  },
}));

import { WorkflowsList } from "@/app/(app)/workflows/workflows-list";

afterEach(() => {
  cleanup();
  q.items = [];
  q.isError = false;
  q.isLoading = false;
  q.lastQueryFn = null;
  vi.unstubAllGlobals();
});

describe("WorkflowsList 이력 목록", () => {
  it("항목을 상세 링크로 렌더", () => {
    q.items = [{ id: "t1", kind: "BILLING", typeName: "2024년 1분기 청구", scheduledAt: "2024-01-15T00:00:00.000Z", status: "SENT" }];
    render(<WorkflowsList />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/workflows/t1");
    expect(screen.getByText("2024년 1분기 청구")).toBeTruthy(); // typeName
    expect(screen.getByText("대금청구")).toBeTruthy(); // KIND_LABEL[BILLING] 배지
  });

  it("range 없이 전체 이력을 조회한다(운영창 밖 접근)", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ items: [] }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkflowsList />);
    await q.lastQueryFn!();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url.startsWith("/api/workflows")).toBe(true);
    // 이력 목록의 핵심: 캘린더와 달리 start/end range를 싣지 않아 전체 이력을 받는다.
    expect(url).not.toContain("start=");
    expect(url).not.toContain("end=");
  });

  it("상태 필터 클릭 시 status 파라미터를 싣는다", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ items: [] }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkflowsList />);
    fireEvent.click(screen.getByRole("button", { name: "발송" }));
    await q.lastQueryFn!();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("status=SENT,FINAL_SENT");
  });

  it("빈 상태 안내", () => {
    q.items = [];
    render(<WorkflowsList />);
    expect(screen.getByText("업무가 없습니다.")).toBeTruthy();
  });

  it("조회 실패 에러상태(빈 위장 금지)", () => {
    q.isError = true;
    render(<WorkflowsList />);
    expect(screen.getByText("목록을 불러오지 못했습니다.")).toBeTruthy();
  });
});
