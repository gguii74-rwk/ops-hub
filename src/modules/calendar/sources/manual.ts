import type { CalendarSourceProvider, FeedContext, NormalizedRange, RawEvent, SourceResult } from "../types";
import { findManualEventsInRange, type ManualRow } from "../repositories";

const KEY = "manual";

function toRawEvent(m: ManualRow): RawEvent {
  return {
    id: `manual:${m.id}`,
    kind: m.kind,
    title: m.title,
    description: m.description,
    start: m.startsAt,
    end: m.endsAt,
    allDay: m.allDay,
    userId: m.userId,
    sourceKey: m.sourceKey,
    externalId: null,
    dedupStatus: "UNIQUE",
    duplicateOfId: null,
    tentative: false,
  };
}

export const manualProvider: CalendarSourceProvider = {
  key: KEY,
  async fetchEvents(range: NormalizedRange, ctx: FeedContext): Promise<SourceResult> {
    try {
      // PERSONAL_EVENT은 본인만(admin은 전체). 권한 차단은 조회 단계 — 마스킹은 안전망이 아님(타인 일정 시각·신원 유출 방지).
      const includeAllPersonal = ctx.isOwner || ctx.permissionKeys.has("calendar.admin:view");
      const rows = await findManualEventsInRange(range, { userId: ctx.userId, includeAllPersonal });
      return { events: rows.map(toRawEvent), statuses: [{ key: KEY, state: "ok", lastFetchedAt: null, error: null }] };
    } catch (e) {
      return { events: [], statuses: [{ key: KEY, state: "failed", lastFetchedAt: null, error: e instanceof Error ? e.message : String(e) }] };
    }
  },
};
