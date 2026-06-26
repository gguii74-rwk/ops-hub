// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// react-query 모킹: useQuery 데이터를 가변 queryData로(테스트가 holidays/unsyncedYears를 주입).
const h = vi.hoisted(() => ({
  queryData: { events: [] as unknown[], holidays: [] as unknown[], unsyncedYears: [] as number[] },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: h.queryData }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));

import { LeaveCalendar } from "@/app/(app)/leave/_components/leave-calendar";

beforeEach(() => {
  h.queryData = { events: [], holidays: [], unsyncedYears: [] };
});
afterEach(() => {
  cleanup();
});

// 현재 KST 달의 15일 셀(항상 inMonth)을 열어 팝오버를 띄운다.
function open15th() {
  const cells = screen
    .getAllByRole("button")
    .filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.getAttribute("aria-label") ?? ""));
  const target = cells.find((b) => (b.getAttribute("aria-label") ?? "").endsWith("-15"))!;
  fireEvent.click(target);
}

describe("LeaveCalendar — 능력별 진입 분리(R1/R4)", () => {
  it("canCreate=true·canManage=false: 자가신청 유지(+ 노출·팝오버 신청), 관리자 입력 없음", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    expect(screen.getAllByRole("button", { name: /추가/ }).length).toBeGreaterThan(0); // 빠른추가 +
    open15th();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("이 날짜로 연차 신청")).toBeTruthy();
    expect(within(dialog).queryByText("관리자 직접 입력")).toBeNull();
  });

  it("canCreate=false·canManage=true: + 없음, 팝오버는 관리자 직접입력만", () => {
    render(<LeaveCalendar canCreate={false} canManage />);
    expect(screen.queryByRole("button", { name: /추가/ })).toBeNull();
    open15th();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("이 날짜로 연차 신청")).toBeNull();
    expect(within(dialog).getByText("관리자 직접 입력")).toBeTruthy();
  });

  it("팝오버 '이 날짜로 연차 신청' 클릭 시 자가신청 모달이 열린다", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    open15th();
    fireEvent.click(within(screen.getByRole("dialog")).getByText("이 날짜로 연차 신청"));
    // 팝오버는 닫히고 자가신청 모달(title "연차 신청")만 남는다
    expect(within(screen.getByRole("dialog")).getByText("연차 신청")).toBeTruthy();
  });

  it("'+' 빠른추가 클릭 시 자가신청 모달이 열린다", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: /추가/ })[0]);
    expect(within(screen.getByRole("dialog")).getByText("연차 신청")).toBeTruthy();
  });
});

describe("LeaveCalendar — 직무 필터·범례·공휴일 안내(D2/D3/D4/D9)", () => {
  it("직무 버튼 4개(전체/개발/민원/콘텐츠) + 기본 '전체' 선택", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    for (const label of ["전체", "개발", "민원", "콘텐츠"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "전체" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "개발" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("직무 버튼 클릭 시 선택(aria-pressed) 전환", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    fireEvent.click(screen.getByRole("button", { name: "개발" }));
    expect(screen.getByRole("button", { name: "개발" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "전체" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("nav(이전/오늘/다음) 버튼 존재", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    for (const label of ["이전", "오늘", "다음"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("변형 A 정적 범례 칩(공휴일/연차/반차/반반차/대기중/반려·취소) 표시", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    for (const t of ["공휴일", "연차", "반차", "반반차", "대기중", "반려/취소"]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
  });

  it("unsyncedYears 비어있지 않으면 인라인 안내 표시", () => {
    h.queryData = { events: [], holidays: [], unsyncedYears: [2027] };
    render(<LeaveCalendar canCreate canManage={false} />);
    expect(screen.getByText(/2027년 공휴일 정보를 불러오지 못했습니다/)).toBeTruthy();
  });

  it("unsyncedYears 비었으면 안내 미표시", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    expect(screen.queryByText(/공휴일 정보를 불러오지 못했습니다/)).toBeNull();
  });
});

describe("LeaveCalendar — nav 운영 창 경계 비활성(D10)", () => {
  it("초기(현재월)엔 이전·다음 모두 활성", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    const prev = screen.getByRole("button", { name: "이전" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "다음" }) as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
  });

  it("다음을 12번 누르면 +12개월 경계에서 다음 비활성(운영 창 끝)", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    for (let i = 0; i < 12; i++) {
      fireEvent.click(screen.getByRole("button", { name: "다음" }));
    }
    const next = screen.getByRole("button", { name: "다음" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it("이전을 12번 누르면 -12개월 경계에서 이전 비활성", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    for (let i = 0; i < 12; i++) {
      fireEvent.click(screen.getByRole("button", { name: "이전" }));
    }
    const prev = screen.getByRole("button", { name: "이전" }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });
});
