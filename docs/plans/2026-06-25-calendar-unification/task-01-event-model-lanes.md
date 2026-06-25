# Task 01 — 공통 이벤트 모델 + lane packing (순수, TDD)

공통 이벤트 모델(`CalendarEventInput`)과 주 단위 lane packing 순수함수(`packWeekLanes`)·날짜 점유 헬퍼(`eventDayKeys`/`eventsForDay`)를 신설한다. half-open 계약(D14)을 한 곳에서 해석해 두 소비처가 단일 규약만 보면 되게 한다.

## Files

- **Create** `src/modules/calendar/ui/event-input.ts` — 공통 타입(§Shared Contracts 그대로).
- **Create** `src/modules/calendar/ui/lanes.ts` — `eventDayKeys`/`eventsForDay`/`packWeekLanes`.
- **Create (test)** `tests/modules/calendar/lanes.test.ts`.

## Prep

- 읽기: spec D7(lane packing)·D14(half-open 계약)·§6(lane packing), entrypoint §Shared Contracts(이벤트 모델·`lanes.ts` 시그니처·날짜 범위 계약).
- 재사용: `src/modules/calendar/time.ts`의 `toKstDateKey`·`kstDayStartUtc`(이미 존재, 무변경). `src/modules/calendar/ui/grid.ts`의 `GridDay`(무변경).
- §Shared Contracts items 사용: `CalendarEventInput`(이 task가 정의), `GridDay`(기존).

## Deps

없음.

## Step 1 — 공통 이벤트 모델 작성 (타입만, 테스트 불필요)

`src/modules/calendar/ui/event-input.ts`:

```ts
// 캘린더 공통 이벤트 모델 — 도메인(CalEvent/Ev)→이 모델 변환은 각 소비처 어댑터(D2).
// 날짜 범위는 half-open [start, end) instant(KST 일자 기준). D14.

export type Intensity = "soft" | "bold";

export type EventStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface CalendarEventInput {
  id: string;
  title: string;
  kind: string; // 색 키(KIND_STYLES, D4). 자유 문자열, 미등록 시 중립 폴백.
  start: string; // ISO instant — half-open 범위 시작(포함). D14.
  end?: string; // ISO instant — half-open 범위 끝(제외). 생략 = 단일일 [kstDayStart, +1일). D14.
  status?: EventStatus | null; // 오버레이(D5). 색과 직교.
}
```

## Step 2 — lane packing 실패 테스트 작성

`tests/modules/calendar/lanes.test.ts`:

```ts
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
```

**Run (expect FAIL — `lanes.ts` 없음):**
```bash
npm test -- tests/modules/calendar/lanes.test.ts
```

## Step 3 — `lanes.ts` 구현

`src/modules/calendar/ui/lanes.ts`:

```ts
import { kstDayStartUtc, toKstDateKey } from "../time";
import type { GridDay } from "./grid";
import type { CalendarEventInput } from "./event-input";

const MS_PER_DAY = 86_400_000;

export interface LaneSegment {
  event: CalendarEventInput;
  colStart: number; // 1..7 (이 주 안 시작 열)
  colEnd: number; // 1..7 (마지막 점유 열, 포함)
  continuesLeft: boolean; // 이 주 시작 이전부터 이어짐(◂)
  continuesRight: boolean; // 이 주 끝 이후로 이어짐(▸)
}

export interface LaneRow {
  segments: LaneSegment[];
}

export interface WeekLanes {
  lanes: LaneRow[]; // maxLanes로 잘린 가시 lane
  more: number[]; // 길이 7, 각 열(col-1 인덱스)에서 잘려 숨겨진 이벤트 수
}

// 이벤트의 KST 점유 일자(inclusive 키). half-open [start,end) → 마지막 날 = end 직전(-1ms). D14.
// end 생략 = 단일일 [kstDayStart(start), +1일).
export function eventDayKeys(ev: CalendarEventInput): { firstKey: string; lastKey: string } {
  const start = new Date(ev.start);
  const endMs = ev.end ? new Date(ev.end).getTime() : kstDayStartUtc(start).getTime() + MS_PER_DAY;
  return { firstKey: toKstDateKey(start), lastKey: toKstDateKey(new Date(endMs - 1)) };
}

// 한 날(day)에 걸치는 이벤트(팝오버·목록용). dateKey는 'YYYY-MM-DD'라 문자열 비교=시간 비교.
export function eventsForDay(day: GridDay, events: CalendarEventInput[]): CalendarEventInput[] {
  return events.filter((ev) => {
    const { firstKey, lastKey } = eventDayKeys(ev);
    return firstKey <= day.dateKey && day.dateKey <= lastKey;
  });
}

// 한 주(7일)의 greedy lane packing. 겹치지 않는 막대는 같은 lane.
export function packWeekLanes(
  weekDays: GridDay[],
  events: CalendarEventInput[],
  maxLanes: number = Number.POSITIVE_INFINITY,
): WeekLanes {
  const weekStart = weekDays[0].dateKey;
  const weekEnd = weekDays[6].dateKey;

  // 이 주에 걸치는 이벤트만 → 주 내 열 범위(LaneSegment)로 변환.
  const segments: LaneSegment[] = [];
  for (const ev of events) {
    const { firstKey, lastKey } = eventDayKeys(ev);
    if (lastKey < weekStart || firstKey > weekEnd) continue; // 이 주와 무관
    const visFirst = firstKey < weekStart ? weekStart : firstKey;
    const visLast = lastKey > weekEnd ? weekEnd : lastKey;
    segments.push({
      event: ev,
      colStart: weekDays.findIndex((d) => d.dateKey === visFirst) + 1,
      colEnd: weekDays.findIndex((d) => d.dateKey === visLast) + 1,
      continuesLeft: firstKey < weekStart,
      continuesRight: lastKey > weekEnd,
    });
  }

  // 정렬: 시작 열 → 더 긴 막대 우선 → id(안정성).
  segments.sort(
    (a, b) =>
      a.colStart - b.colStart ||
      b.colEnd - b.colStart - (a.colEnd - a.colStart) ||
      (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0),
  );

  // greedy: 각 lane의 마지막 점유 열보다 colStart가 크면 같은 lane에 이어붙임.
  const laneEnds: number[] = [];
  const allLanes: LaneRow[] = [];
  for (const seg of segments) {
    let placed = laneEnds.findIndex((end) => end < seg.colStart);
    if (placed === -1) {
      placed = laneEnds.length;
      laneEnds.push(0);
      allLanes.push({ segments: [] });
    }
    allLanes[placed].segments.push(seg);
    laneEnds[placed] = seg.colEnd;
  }

  // maxLanes 초과 lane은 숨기고, 각 열의 숨겨진 이벤트 수 집계.
  const lanes = allLanes.slice(0, maxLanes);
  const more = new Array(7).fill(0);
  for (const lane of allLanes.slice(maxLanes)) {
    for (const seg of lane.segments) {
      for (let c = seg.colStart; c <= seg.colEnd; c++) more[c - 1] += 1;
    }
  }
  return { lanes, more };
}
```

**Run (expect PASS):**
```bash
npm test -- tests/modules/calendar/lanes.test.ts
```

## Step 4 — commit

```bash
git add src/modules/calendar/ui/event-input.ts src/modules/calendar/ui/lanes.ts tests/modules/calendar/lanes.test.ts
git commit -m "feat(calendar): 공통 이벤트 모델 + 주 단위 lane packing 순수함수(half-open D14)"
```

## Acceptance Criteria

```bash
npm test -- tests/modules/calendar/lanes.test.ts   # 전부 PASS
npm run typecheck                                  # 에러 0
npm run lint                                       # boundaries 포함 통과(ui→time/grid는 module 내부 import라 허용)
```
- `event-input.ts`·`lanes.ts`만 신규, `grid.ts`/`time.ts`는 diff 없음.

## Cautions

- **`grid.ts`를 generic으로 고치지 말 것.** 이유: `buildMonthGrid`는 `CalEvent[]`로 테스트(`grid.test.ts`)됐고 D10/surgical. lane packing은 `CalendarEventInput`으로 **별도** 수행한다(컴포넌트가 `buildMonthGrid(anchor, [], now)`로 스켈레톤만 얻음, task 03).
- **`end`를 inclusive로 해석하지 말 것.** 이유: D14 — half-open `[start, end)`. 마지막 점유 날은 `end - 1ms`. inclusive로 보면 막대가 하루 길어진다.
- **`weekDays.findIndex` 결과가 -1이 될 일은 없다**(visFirst/visLast는 clamp 후 항상 그 주 7일 중 하나) — 방어 코드 추가 금지(YAGNI). 단, `weekDays`는 반드시 길이 7로 호출한다(컴포넌트가 보장).
- **`Date.now()`/타임존 가정 금지.** `now`는 호출자 주입, KST 변환은 `time.ts` 헬퍼만 사용.
