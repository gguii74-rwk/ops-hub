import { describe, it, expect } from "vitest";
import { buildMonthGrid } from "@/modules/calendar/ui/grid";
import { eventDayKeys, eventsForDay, packWeekLanes } from "@/modules/calendar/ui/lanes";
import type { CalendarEventInput } from "@/modules/calendar/ui/event-input";
import { allDayHalfOpen } from "@/modules/calendar/time";

// 2026-06 그리드: 첫 주 = 2026-05-31(일)~2026-06-06(토). (grid.test.ts와 동일 앵커)
const grid = buildMonthGrid(new Date("2026-06-15T03:00:00+09:00"), []);
const week0 = grid.slice(0, 7); // 05-31 ~ 06-06
const week1 = grid.slice(7, 14); // 06-07 ~ 06-13

// KST 일자 D의 00:00(=전날 15:00Z)를 ISO로.
const kst = (dateKey: string) => `${dateKey}T00:00:00+09:00`;

function ev(p: Partial<CalendarEventInput>): CalendarEventInput {
  return { id: "e", title: "t", kind: "WORKFLOW_TASK", start: kst("2026-06-02"), ...p };
}

describe("eventDayKeys (D14 half-open 해석)", () => {
  it("end 생략 = 단일일", () => {
    expect(eventDayKeys(ev({ start: kst("2026-06-02") }))).toEqual({
      firstKey: "2026-06-02",
      lastKey: "2026-06-02",
    });
  });

  it("half-open exclusive end는 직전 날까지만 점유(자정 정각 종료가 다음 날 미점유)", () => {
    // all-day external: 06-01 00:00 ~ 06-04 00:00 KST(exclusive) → 06-01,02,03
    const e = ev({ start: kst("2026-06-01"), end: kst("2026-06-04") });
    expect(eventDayKeys(e)).toEqual({ firstKey: "2026-06-01", lastKey: "2026-06-03" });
  });

  it("연차 inclusive 범위(6/1~6/3)는 allDayHalfOpen 변환 후 정확히 3일 점유", () => {
    const { start, end } = allDayHalfOpen(new Date("2026-06-01T00:00:00Z"), new Date("2026-06-03T00:00:00Z"));
    const e = ev({ start: start.toISOString(), end: end.toISOString() });
    expect(eventDayKeys(e)).toEqual({ firstKey: "2026-06-01", lastKey: "2026-06-03" });
  });
});

describe("eventsForDay", () => {
  it("기간 이벤트는 걸친 모든 날에, 그 밖은 미포함", () => {
    const e = ev({ id: "m", start: kst("2026-06-01"), end: kst("2026-06-04") }); // 06-01~03
    const day01 = grid.find((d) => d.dateKey === "2026-06-01")!;
    const day03 = grid.find((d) => d.dateKey === "2026-06-03")!;
    const day04 = grid.find((d) => d.dateKey === "2026-06-04")!;
    expect(eventsForDay(day01, [e]).map((x) => x.id)).toEqual(["m"]);
    expect(eventsForDay(day03, [e]).map((x) => x.id)).toEqual(["m"]);
    expect(eventsForDay(day04, [e])).toHaveLength(0);
  });
});

describe("packWeekLanes", () => {
  it("단일일 이벤트 = 1칸, continues 플래그 없음", () => {
    const { lanes } = packWeekLanes(week1, [ev({ id: "a", start: kst("2026-06-09") })]);
    expect(lanes).toHaveLength(1);
    const seg = lanes[0].segments[0];
    expect([seg.colStart, seg.colEnd]).toEqual([3, 3]); // 06-09 = 화 = 3열
    expect(seg.continuesLeft).toBe(false);
    expect(seg.continuesRight).toBe(false);
  });

  it("같은 주 기간 이벤트 = colStart..colEnd 연속", () => {
    // 06-08(월,2열)~06-10(수,4열)
    const e = ev({ id: "b", start: kst("2026-06-08"), end: kst("2026-06-11") });
    const { lanes } = packWeekLanes(week1, [e]);
    const seg = lanes[0].segments[0];
    expect([seg.colStart, seg.colEnd]).toEqual([2, 4]);
  });

  it("겹치는 2건은 서로 다른 lane", () => {
    const a = ev({ id: "a", start: kst("2026-06-08"), end: kst("2026-06-10") }); // 08~09
    const b = ev({ id: "b", start: kst("2026-06-09"), end: kst("2026-06-11") }); // 09~10
    const { lanes } = packWeekLanes(week1, [a, b]);
    expect(lanes).toHaveLength(2);
  });

  it("안 겹치는 2건은 같은 lane", () => {
    const a = ev({ id: "a", start: kst("2026-06-08") }); // 08
    const b = ev({ id: "b", start: kst("2026-06-10") }); // 10
    const { lanes } = packWeekLanes(week1, [a, b]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].segments.map((s) => s.event.id)).toEqual(["a", "b"]);
  });

  it("주 경계로 잘리면 continuesLeft/Right + colStart=1/colEnd=7", () => {
    // 05-31(일)~06-08(월): week0에서 continuesRight, week1에서 continuesLeft
    const e = ev({ id: "span", start: kst("2026-05-31"), end: kst("2026-06-09") });
    const w0 = packWeekLanes(week0, [e]).lanes[0].segments[0];
    expect([w0.colStart, w0.colEnd]).toEqual([1, 7]);
    expect(w0.continuesRight).toBe(true);
    expect(w0.continuesLeft).toBe(false);
    const w1 = packWeekLanes(week1, [e]).lanes[0].segments[0];
    expect([w1.colStart, w1.colEnd]).toEqual([1, 2]); // 06-07,06-08
    expect(w1.continuesLeft).toBe(true);
  });

  it("maxLanes 초과분은 more[]로 집계", () => {
    const evs = [
      ev({ id: "a", start: kst("2026-06-09"), end: kst("2026-06-10") }),
      ev({ id: "b", start: kst("2026-06-09"), end: kst("2026-06-10") }),
      ev({ id: "c", start: kst("2026-06-09"), end: kst("2026-06-10") }),
    ];
    const { lanes, more } = packWeekLanes(week1, evs, 2);
    expect(lanes).toHaveLength(2);
    expect(more[2]).toBe(1); // 06-09 = 3열(인덱스 2)에서 1건 숨김
  });

  it("정렬 안정성: 같은 시작은 더 긴 막대 우선", () => {
    const short = ev({ id: "short", start: kst("2026-06-08") }); // 08
    const long = ev({ id: "long", start: kst("2026-06-08"), end: kst("2026-06-11") }); // 08~10
    const { lanes } = packWeekLanes(week1, [short, long]);
    // 겹치므로 2 lane, 첫 lane = 더 긴 long
    expect(lanes[0].segments[0].event.id).toBe("long");
  });
});
