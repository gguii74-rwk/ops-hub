import type { CalendarSourceProvider, NormalizedRange, RawEvent, SourceResult } from "../types";
import { findLeaveInRange, type LeaveRow } from "../repositories";
import { allDayHalfOpen } from "../time";

const KEY = "internalLeave";

function toRawEvent(l: LeaveRow): RawEvent {
  const { start, end } = allDayHalfOpen(l.startDate, l.endDate);
  return {
    id: `leave:${l.id}`,
    kind: "INTERNAL_LEAVE",
    title: "휴가",
    description: l.reason,
    start,
    end,
    allDay: true,
    userId: l.userId,
    sourceKey: KEY,
    externalId: null,
    dedupStatus: "UNIQUE",
    duplicateOfId: null,
    tentative: l.status === "PENDING", // 미승인 휴가는 잠정 — 본인/admin만 노출, dedup 앵커 제외(§10)
  };
}

export const internalLeaveProvider: CalendarSourceProvider = {
  key: KEY,
  async fetchEvents(range: NormalizedRange): Promise<SourceResult> {
    try {
      const rows = await findLeaveInRange(range, ["APPROVED", "PENDING"]);
      return { events: rows.map(toRawEvent), statuses: [{ key: KEY, state: "ok", lastFetchedAt: null, error: null }] };
    } catch (e) {
      return { events: [], statuses: [{ key: KEY, state: "failed", lastFetchedAt: null, error: e instanceof Error ? e.message : String(e) }] };
    }
  },
};
