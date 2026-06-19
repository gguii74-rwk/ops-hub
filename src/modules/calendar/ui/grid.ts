import { normalizeToGridWindow, toKstDateKey } from "../time";
import type { CalEvent } from "../types";

const MS_PER_DAY = 86_400_000;

export interface GridDay {
  dateKey: string; // 'YYYY-MM-DD' (KST)
  iso: string; // 그 날 00:00 KST의 UTC instant
  inMonth: boolean;
  isToday: boolean; // now가 속한 KST 날짜
  isPast: boolean; // 오늘(KST) 이전. 오늘·미래는 false
  events: CalEvent[];
}

export function buildMonthGrid(anchor: Date, events: CalEvent[], now: Date = new Date()): GridDay[] {
  const { start } = normalizeToGridWindow(anchor);
  const anchorMonth = toKstDateKey(anchor).slice(0, 7);
  const todayKey = toKstDateKey(now); // 오늘/지난날 판정은 KST 기준. 'YYYY-MM-DD'는 사전순=시간순이라 문자열 비교로 충분.
  const days: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const dayStart = new Date(start.getTime() + i * MS_PER_DAY);
    const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);
    const dayEvents = events.filter((e) => {
      const s = new Date(e.start).getTime();
      const en = new Date(e.end).getTime();
      return s < dayEnd.getTime() && dayStart.getTime() < en;
    });
    const dateKey = toKstDateKey(dayStart);
    days.push({
      dateKey,
      iso: dayStart.toISOString(),
      inMonth: dateKey.slice(0, 7) === anchorMonth,
      isToday: dateKey === todayKey,
      isPast: dateKey < todayKey,
      events: dayEvents,
    });
  }
  return days;
}
