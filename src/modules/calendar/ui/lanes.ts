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
