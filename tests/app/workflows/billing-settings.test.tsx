// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.hoisted(() => vi.fn());
const data = vi.hoisted(() => ({ list: [] as unknown[], rounds: [] as unknown[] }));
const toastErr = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidate }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === "billing-rounds" ? data.rounds : data.list,
    isLoading: false, isError: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { error: toastErr, success: vi.fn() } }));

import { BillingSettings } from "@/app/(app)/workflows/billing/settings/billing-settings";
import { dateInputToSubmitDateIso } from "@/app/(app)/workflows/billing/settings/round-date";

const cfg = {
  id: "c1", year: 2026, projectName: "P", contractNumber: "C-1",
  contractAmount: 1200, monthlyAmount: 100, contractAmountKor: "천이백", monthlyAmountKor: "백",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => { data.list = [cfg]; data.rounds = []; invalidate.mockClear(); toastErr.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function selectYear(y: string) {
  fireEvent.change(screen.getByLabelText("연도 선택"), { target: { value: y } });
}

describe("BillingSettings 권한 게이트", () => {
  it("canConfigure=false면 저장/삭제·회차 저장 버튼 미노출(read-only)", () => {
    render(<BillingSettings canConfigure={false} />);
    selectYear("2026");
    expect(screen.queryByLabelText("계약 정보 저장")).toBeNull();
    expect(screen.queryByLabelText("계약 정보 삭제")).toBeNull();
    expect(screen.queryByLabelText("1회차 저장")).toBeNull();
  });
});

describe("계약 정보 저장 검증", () => {
  it("금액이 0이면 toast 오류 + fetch 미호출", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<BillingSettings canConfigure />);
    selectYear("2026");
    fireEvent.change(screen.getByLabelText("총 계약금액(원)"), { target: { value: "0" } });
    fireEvent.click(screen.getByLabelText("계약 정보 저장"));
    expect(toastErr).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("회차 저장", () => {
  it("date 입력 → PUT submitDate가 KST→UTC ISO로 변환(D11)", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<BillingSettings canConfigure />);
    selectYear("2026");
    fireEvent.change(screen.getByLabelText("1회차 제출일"), { target: { value: "2026-02-10" } });
    fireEvent.click(screen.getByLabelText("1회차 저장"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/billing/config/2026/rounds/1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ submitDate: dateInputToSubmitDateIso("2026-02-10") });
  });
});

describe("계약 정보 삭제 확인(F-A3)", () => {
  it("삭제 클릭만으로는 DELETE 미호출 — 확인 후에만 실행(회차 연쇄 손실 방지)", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<BillingSettings canConfigure />);
    selectYear("2026");
    fireEvent.click(screen.getByLabelText("계약 정보 삭제"));
    expect(fetchMock).not.toHaveBeenCalled(); // 확인 단계만 노출, 아직 삭제 안 함
    fireEvent.click(screen.getByLabelText("삭제 확정"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/billing/config/2026");
    expect(init.method).toBe("DELETE");
  });

  it("삭제 확정 후 선택 해제 — 폼 unmount(stale 값 재생성 차단, F-B1)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<BillingSettings canConfigure />);
    selectYear("2026");
    expect(screen.getByLabelText("계약 정보 저장")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("계약 정보 삭제"));
    fireEvent.click(screen.getByLabelText("삭제 확정"));
    // onDeleted → 부모 selectedYear=null → ConfigForm/RoundsTable unmount(저장 버튼 사라짐). stale form 유지 안 함.
    await waitFor(() => expect(screen.queryByLabelText("계약 정보 저장")).toBeNull());
  });
});
