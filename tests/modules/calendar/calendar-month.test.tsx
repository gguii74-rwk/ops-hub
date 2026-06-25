// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarMonth } from "@/modules/calendar/ui/calendar-month";
import type { CalendarEventInput } from "@/modules/calendar/ui/event-input";

afterEach(cleanup);

const ANCHOR = new Date("2026-06-15T03:00:00+09:00");
const NOW = new Date("2026-06-15T03:00:00+09:00");
const kst = (dateKey: string) => `${dateKey}T00:00:00+09:00`;

function ev(p: Partial<CalendarEventInput>): CalendarEventInput {
  return { id: "e1", title: "이벤트", kind: "WORKFLOW_TASK", start: kst("2026-06-10"), ...p };
}

describe("CalendarMonth — 색강도/오버레이", () => {
  it("intensity bold/soft가 막대 클래스에 반영", () => {
    const { rerender } = render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({})]} intensity="bold" />);
    expect(screen.getByText("이벤트").className).toContain("orange-500");
    rerender(<CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({})]} intensity="soft" />);
    expect(screen.getByText("이벤트").className).toContain("orange-100");
  });

  it("status 오버레이: PENDING 점선 / CANCELLED 취소선", () => {
    const { rerender } = render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({ status: "PENDING" })]} />);
    expect(screen.getByText("이벤트").className).toContain("border-dashed");
    rerender(<CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({ status: "CANCELLED" })]} />);
    expect(screen.getByText("이벤트").className).toContain("line-through");
  });
});

describe("CalendarMonth — 시간 방향", () => {
  it("오늘 셀은 날짜 숫자가 브랜드 채움, 지난날 셀은 음영 톤", () => {
    render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[]} />);
    const today = screen.getByRole("button", { name: "2026-06-15" });
    expect(within(today).getByText("15").className).toContain("bg-primary");
    const past = screen.getByRole("button", { name: "2026-06-10" });
    expect(past.className).toContain("bg-muted-foreground/5");
  });
});

describe("CalendarMonth — 팝오버(D8)", () => {
  it("셀 클릭 → renderDayDetail 호출·role=dialog 표시, Esc·바깥클릭 닫힘", () => {
    render(
      <CalendarMonth
        anchor={ANCHOR}
        now={NOW}
        events={[ev({})]}
        renderDayDetail={(ctx) => <p>상세:{ctx.dateKey}</p>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "2026-06-10" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true"); // 인라인 다이얼로그 포커스 트랩 계약(D8/D13)
    expect(screen.getByText("상세:2026-06-10")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    // 바깥(오버레이) 클릭 닫힘 — Modal 오버레이는 dialog의 부모(backdrop)
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renderDayDetail 미주입 시 기본 목록 렌더", () => {
    render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({})]} />);
    fireEvent.click(screen.getByRole("button", { name: "2026-06-10" }));
    expect(within(screen.getByRole("dialog")).getByText("이벤트")).toBeTruthy();
  });

  it("열린 팝오버는 events 변경(리패칭) 시 갱신된다 (R2 — stale 캡처 방지)", () => {
    const detail = (events: CalendarEventInput[]) => (
      <ul>{events.map((e) => <li key={e.id}>{e.title}</li>)}</ul>
    );
    const { rerender } = render(
      <CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({ id: "a", title: "기존연차" })]} renderDayDetail={(c) => detail(c.events)} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "2026-06-10" }));
    expect(within(screen.getByRole("dialog")).getByText("기존연차")).toBeTruthy();
    // 백그라운드 리패칭으로 그 날 이벤트가 교체됨 — 팝오버는 열린 채 갱신되어야 함
    rerender(
      <CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({ id: "b", title: "갱신연차" })]} renderDayDetail={(c) => detail(c.events)} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("기존연차")).toBeNull();
    expect(within(dialog).getByText("갱신연차")).toBeTruthy();
  });

  it("포커스 트랩: 마지막 포커스 요소에서 Tab → 첫 요소로 순환 (R5 — module 내부 인라인 트랩)", () => {
    render(
      <CalendarMonth
        anchor={ANCHOR}
        now={NOW}
        events={[]}
        renderDayDetail={() => (
          <>
            <button type="button">액션A</button>
            <button type="button">액션B</button>
          </>
        )}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "2026-06-10" }));
    const dialog = screen.getByRole("dialog");
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    );
    focusables[focusables.length - 1].focus(); // 마지막(액션B)
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]); // 첫(닫기 ✕)로 순환
  });
});

describe("CalendarMonth — 빠른추가(D9)", () => {
  it("onQuickAdd 미주입 → + 없음", () => {
    render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[]} />);
    expect(screen.queryByRole("button", { name: /추가/ })).toBeNull();
  });
  it("주입 시 + 노출·클릭 콜백(팝오버 안 열림)", () => {
    const onQuickAdd = vi.fn();
    render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[]} onQuickAdd={onQuickAdd} renderDayDetail={() => <p>x</p>} />);
    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 추가" }));
    expect(onQuickAdd).toHaveBeenCalledWith("2026-06-10");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("CalendarMonth — 범례 필터(D12)", () => {
  it("kind 토글로 해당 막대 숨김", () => {
    const events = [
      ev({ id: "a", title: "업무이벤트", kind: "WORKFLOW_TASK" }),
      ev({ id: "b", title: "공휴일이벤트", kind: "HOLIDAY" }),
    ];
    render(<CalendarMonth anchor={ANCHOR} now={NOW} events={events} legend />);
    expect(screen.getByText("업무이벤트")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "WORKFLOW_TASK" }));
    expect(screen.queryByText("업무이벤트")).toBeNull();
    expect(screen.getByText("공휴일이벤트")).toBeTruthy();
  });
});

describe("CalendarMonth — 키보드(D13)", () => {
  it("Enter로 팝오버, 방향키로 셀 포커스 이동", () => {
    render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[]} renderDayDetail={() => <p>키보드</p>} />);
    const cell = screen.getByRole("button", { name: "2026-06-10" });
    cell.focus();
    fireEvent.keyDown(cell, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "2026-06-11" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "2026-06-11" }), { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
