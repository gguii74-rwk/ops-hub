// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// react-query 모킹: useQuery(빈 이벤트) + RequestLeaveModal이 쓰는 useMutation/useQueryClient.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [] }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));

import { LeaveCalendar } from "@/app/(app)/leave/_components/leave-calendar";

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
