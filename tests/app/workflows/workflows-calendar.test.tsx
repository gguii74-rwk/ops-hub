// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeToGridWindow, toKstDateKey } from "@/modules/calendar/time";

const push = vi.hoisted(() => vi.fn());
const can = vi.hoisted(() => ({ create: false }));
const q = vi.hoisted(() => ({ items: [] as any[], isError: false, lastQueryFn: null as null | (() => Promise<unknown>) }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/auth/permissions-client", () => ({
  useCan: (_r: string, a: string) => a === "create" && can.create,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryFn: () => Promise<unknown> }) => { q.lastQueryFn = opts.queryFn; return { data: q.isError ? undefined : { items: q.items }, isError: q.isError }; },
}));
// 모달은 스텁(자체 useCan/useMutation 격리).
vi.mock("@/app/(app)/workflows/create-task-modal", () => ({
  CreateTaskModal: ({ defaultDate }: { defaultDate?: string }) => <div data-testid="create-modal">{defaultDate ?? "no-date"}</div>,
}));

import { WorkflowsCalendar } from "@/app/(app)/workflows/workflows-calendar";

// 현재 KST 달의 15일(항상 inMonth) 정오 ISO — 셀에 이벤트를 얹기 위한 안정 날짜.
function month15Iso() {
  const key = toKstDateKey(new Date());
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1;
  return new Date(Date.UTC(y, m, 15, 3, 0, 0)).toISOString();
}
function open15th() {
  const cells = screen.getAllByRole("button").filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.getAttribute("aria-label") ?? ""));
  const target = cells.find((b) => (b.getAttribute("aria-label") ?? "").endsWith("-15"))!;
  fireEvent.click(target);
}

beforeEach(() => { q.items = []; q.isError = false; q.lastQueryFn = null; can.create = false; push.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("WorkflowsCalendar — 필터(D6)", () => {
  it("필터 버튼 6개(전체+5 kind)·기본 전체", () => {
    render(<WorkflowsCalendar />);
    for (const label of ["전체", "대금청구", "알림톡청구", "주간보고(본부)", "주간보고(고객사)", "월간보고(고객사)"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "전체" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("필터 클릭 시 단일선택 전환", () => {
    render(<WorkflowsCalendar />);
    fireEvent.click(screen.getByRole("button", { name: "대금청구" }));
    expect(screen.getByRole("button", { name: "대금청구" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "전체" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("kind 미스매치는 숨김(클라 필터)", () => {
    q.items = [
      { id: "b1", kind: "BILLING", typeName: "대금청구", scheduledAt: month15Iso(), status: "PENDING" },
      { id: "w1", kind: "WEEKLY_REPORT", typeName: "주간보고(본부)", scheduledAt: month15Iso(), status: "PENDING" },
    ];
    render(<WorkflowsCalendar />);
    fireEvent.click(screen.getByRole("button", { name: "대금청구" }));
    open15th();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("대금청구")).toBeTruthy();
    expect(within(dialog).queryByText("주간보고(본부)")).toBeNull();
  });
});

describe("WorkflowsCalendar — 팝오버·생성(D9)", () => {
  it("빈 날짜는 '업무 없음'", () => {
    render(<WorkflowsCalendar />);
    open15th();
    expect(within(screen.getByRole("dialog")).getByText("업무 없음")).toBeTruthy();
  });

  it("생성 권한 없으면 '+' 빠른추가·'새 작업 등록' 미노출", () => {
    can.create = false;
    render(<WorkflowsCalendar />);
    expect(screen.queryByRole("button", { name: /추가/ })).toBeNull();
    open15th();
    expect(within(screen.getByRole("dialog")).queryByText("새 작업 등록")).toBeNull();
  });

  it("생성 권한 있으면 '+' 빠른추가·'새 작업 등록' 노출", () => {
    can.create = true;
    render(<WorkflowsCalendar />);
    expect(screen.getAllByRole("button", { name: /추가/ }).length).toBeGreaterThan(0);
    open15th();
    expect(within(screen.getByRole("dialog")).getByText("새 작업 등록")).toBeTruthy();
  });

  it("'새 작업 등록' 클릭 시 생성 모달(defaultDate=그날)", () => {
    can.create = true;
    render(<WorkflowsCalendar />);
    open15th();
    fireEvent.click(within(screen.getByRole("dialog")).getByText("새 작업 등록"));
    const modal = screen.getByTestId("create-modal");
    expect(modal.textContent).toMatch(/^\d{4}-\d{2}-15$/);
  });

  it("작업 클릭 시 상세로 이동", () => {
    q.items = [{ id: "b1", kind: "BILLING", typeName: "대금청구", scheduledAt: month15Iso(), status: "PENDING" }];
    render(<WorkflowsCalendar />);
    open15th();
    fireEvent.click(within(screen.getByRole("dialog")).getByText("대금청구"));
    expect(push).toHaveBeenCalledWith("/workflows/b1");
  });
});

describe("WorkflowsCalendar — 조회 URL(R1·R4)·nav 경계(D10)", () => {
  it("queryFn URL에 start·end(exclusive winEnd) 포함", async () => {
    render(<WorkflowsCalendar />);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    await q.lastQueryFn!();
    const url = fetchMock.mock.calls[0][0] as string;
    const key = toKstDateKey(new Date());
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(5, 7)) - 1;
    const { start, end } = normalizeToGridWindow(new Date(Date.UTC(y, m, 15, 3, 0, 0)));
    expect(url).toContain(`start=${encodeURIComponent(start.toISOString())}`);
    expect(url).toContain(`end=${encodeURIComponent(end.toISOString())}`); // exclusive end(R4·F2)
  });

  it("이전/오늘/다음 버튼 존재·초기 활성", () => {
    render(<WorkflowsCalendar />);
    for (const label of ["이전", "오늘", "다음"]) expect(screen.getByRole("button", { name: label })).toBeTruthy();
    expect((screen.getByRole("button", { name: "다음" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("다음 12번 → +12개월 경계에서 다음 비활성", () => {
    render(<WorkflowsCalendar />);
    for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect((screen.getByRole("button", { name: "다음" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("WorkflowsCalendar — 범례(D8)", () => {
  it("5 kind 색칩 + 취소됨 안내", () => {
    render(<WorkflowsCalendar />);
    // 범례는 색칩(라벨 텍스트)로 렌더 — 필터 버튼과 텍스트 중복이라 getAllByText로 존재만 확인
    for (const label of ["대금청구", "알림톡청구", "주간보고(본부)", "주간보고(고객사)", "월간보고(고객사)"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("취소됨")).toBeTruthy();
  });
});

describe("WorkflowsCalendar — 조회 실패 에러상태(SC-13)", () => {
  it("조회 실패 시 에러 배너 노출(빈 캘린더로 위장 안 함)", () => {
    q.isError = true;
    render(<WorkflowsCalendar />);
    expect(screen.getByText("업무 캘린더를 불러오지 못했습니다.")).toBeTruthy();
  });

  it("정상(비-에러) 시 에러 배너 없음", () => {
    render(<WorkflowsCalendar />);
    expect(screen.queryByText("업무 캘린더를 불러오지 못했습니다.")).toBeNull();
  });
});
