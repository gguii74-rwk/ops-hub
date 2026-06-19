import { normalizeToGridWindow, toKstDateKey } from "../time";
import type { CalEvent } from "../types";

const MS_PER_DAY = 86_400_000;

export interface GridDay {
  dateKey: string; // 'YYYY-MM-DD' (KST)
  iso: string; // 그 날 00:00 KST의 UTC instant
  inMonth: boolean;
  events: CalEvent[];
}

export function buildMonthGrid(anchor: Date, events: CalEvent[]): GridDay[] {
  const { start } = normalizeToGridWindow(anchor);
  const anchorMonth = toKstDateKey(anchor).slice(0, 7);
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
    days.push({ dateKey, iso: dayStart.toISOString(), inMonth: dateKey.slice(0, 7) === anchorMonth, events: dayEvents });
  }
  return days;
}
