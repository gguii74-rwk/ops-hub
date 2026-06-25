// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// react-query useQuery → 빈 이벤트 고정(패칭 무력화). leave-calendar는 useQuery만 사용.
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }) }));
// next/navigation useRouter → push 캡처(자가신청 라우팅 검증)
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { LeaveCalendar } from "@/app/(app)/leave/_components/leave-calendar";

afterEach(() => {
  cleanup();
  router.push.mockClear();
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

  it("자가신청 버튼은 /leave/request?date= 로 라우팅(제출 경로 보존)", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    open15th();
    fireEvent.click(within(screen.getByRole("dialog")).getByText("이 날짜로 연차 신청"));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(String(router.push.mock.calls[0][0])).toMatch(/^\/leave\/request\?date=\d{4}-\d{2}-\d{2}$/);
  });
});
