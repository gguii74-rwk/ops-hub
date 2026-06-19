import { describe, it, expect } from "vitest";
import { buildMonthGrid } from "@/modules/calendar/ui/grid";
import type { CalEvent } from "@/modules/calendar/types";

function evt(p: Partial<CalEvent>): CalEvent {
  return {
    id: "e", kind: "WORKFLOW_TASK", title: "주간보고", description: null,
    start: "2026-06-11T15:00:00.000Z", end: "2026-06-12T15:00:00.000Z", // 06-12 KST all-day
    allDay: true, userId: null, sourceKey: "workflowTask", dedupStatus: "UNIQUE", masked: false, tentative: false, ...p,
  };
}

describe("buildMonthGrid", () => {
  it("6주(42칸) 생성, 첫 칸은 2026-05-31(일), 달력 외 날짜는 inMonth=false", () => {
    const grid = buildMonthGrid(new Date("2026-06-15T03:00:00+09:00"), []);
    expect(grid).toHaveLength(42);
    expect(grid[0].dateKey).toBe("2026-05-31");
    expect(grid[0].inMonth).toBe(false);
    expect(grid.find((d) => d.dateKey === "2026-06-01")!.inMonth).toBe(true);
    expect(grid.find((d) => d.dateKey === "2026-06-15")!.inMonth).toBe(true);
  });

  it("이벤트가 겹치는 KST 날짜 칸에 배치", () => {
    const grid = buildMonthGrid(new Date("2026-06-15T03:00:00+09:00"), [evt({ id: "w1" })]);
    const day12 = grid.find((d) => d.dateKey === "2026-06-12")!;
    expect(day12.events.map((e) => e.id)).toEqual(["w1"]);
    const day13 = grid.find((d) => d.dateKey === "2026-06-13")!;
    expect(day13.events).toHaveLength(0);
  });

  it("여러 날 걸친 이벤트는 각 날짜에 모두 배치", () => {
    const multi = evt({ id: "m1", start: "2026-06-09T15:00:00.000Z", end: "2026-06-11T15:00:00.000Z" }); // 06-10~06-11 KST
    const grid = buildMonthGrid(new Date("2026-06-15T03:00:00+09:00"), [multi]);
    expect(grid.find((d) => d.dateKey === "2026-06-10")!.events).toHaveLength(1);
    expect(grid.find((d) => d.dateKey === "2026-06-11")!.events).toHaveLength(1);
    expect(grid.find((d) => d.dateKey === "2026-06-12")!.events).toHaveLength(0);
  });

  it("now가 속한 칸은 isToday, 이전은 isPast, 이후는 둘 다 false", () => {
    const grid = buildMonthGrid(new Date("2026-06-15T03:00:00+09:00"), [], new Date("2026-06-15T03:00:00+09:00"));
    const today = grid.find((d) => d.dateKey === "2026-06-15")!;
    expect(today.isToday).toBe(true);
    expect(today.isPast).toBe(false);
    const past = grid.find((d) => d.dateKey === "2026-06-10")!;
    expect(past.isPast).toBe(true);
    expect(past.isToday).toBe(false);
    const future = grid.find((d) => d.dateKey === "2026-06-20")!;
    expect(future.isPast).toBe(false);
    expect(future.isToday).toBe(false);
  });

  it("오늘/지난날 판정은 KST 기준(UTC 늦은 밤 → KST 다음날)", () => {
    // 2026-06-15T20:00Z = 2026-06-16 05:00 KST → 오늘은 06-16, 06-15는 지난날
    const grid = buildMonthGrid(new Date("2026-06-15T03:00:00+09:00"), [], new Date("2026-06-15T20:00:00Z"));
    expect(grid.find((d) => d.dateKey === "2026-06-16")!.isToday).toBe(true);
    expect(grid.find((d) => d.dateKey === "2026-06-15")!.isToday).toBe(false);
    expect(grid.find((d) => d.dateKey === "2026-06-15")!.isPast).toBe(true);
  });
});
