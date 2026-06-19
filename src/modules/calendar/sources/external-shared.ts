import type { CalendarEventKind } from "@prisma/client";
import { getGoogleCalendarClient, type GoogleCalendarClient, type NormalizedGoogleEvent } from "@/lib/integrations/google";
import { findSourcesByKind, type SourceRow } from "../repositories";
import { getCachedPayload } from "../cache";
import type { CalendarSourceProvider, NormalizedRange, RawEvent, SourceResult, SourceStatus } from "../types";

// 캐시에 저장하는 직렬화 가능한 형태(Date → ISO).
export interface CachedGoogleEvent {
  id: string;
  summary: string | null;
  description: string | null;
  start: string;
  end: string;
  allDay: boolean;
}

export function toCached(n: NormalizedGoogleEvent): CachedGoogleEvent {
  return { id: n.id, summary: n.summary, description: n.description, start: n.start.toISOString(), end: n.end.toISOString(), allDay: n.allDay };
}

export function cachedToRawEvent(c: CachedGoogleEvent, sourceKey: string, kind: CalendarEventKind, userId: string | null): RawEvent {
  const fallbackTitle = kind === "HOLIDAY" ? "공휴일" : "외부 일정";
  return {
    id: `${sourceKey}:${c.id}`,
    kind,
    title: c.summary ?? fallbackTitle,
    description: c.description,
    start: new Date(c.start),
    end: new Date(c.end),
    allDay: c.allDay,
    userId, // CalendarSource.ownerUserId에서 전파 — dedup attribution(§10). 공유 캘린더면 null.
    sourceKey,
    externalId: c.id,
    dedupStatus: "UNIQUE",
    duplicateOfId: null,
    tentative: false, // 외부 일정은 잠정 개념 없음
  };
}

export interface ExternalProviderOpts {
  client?: GoogleCalendarClient;
  forceRefresh?: boolean;
  now?: () => Date;
}

interface ExternalProviderConfig {
  key: string;
  sourceKinds: Array<"GOOGLE_CALENDAR" | "HOLIDAY">;
  eventKind: CalendarEventKind;
  ownerOf: (s: SourceRow) => string | null; // google=개인 소스 ownerUserId 전파, holiday=항상 null
}

// google·holiday provider의 cache-first 루프는 동일하다(소스 종류·event kind·owner 귀속만 다름).
// 중복 복붙 대신 한 팩토리로 둔다(적대적 리뷰 pre-flight). google.ts/holiday.ts는 cfg만 다른 얇은 래퍼.
export function createExternalProvider(opts: ExternalProviderOpts, cfg: ExternalProviderConfig): CalendarSourceProvider {
  return {
    key: cfg.key,
    async fetchEvents(range: NormalizedRange): Promise<SourceResult> {
      const sources = await findSourcesByKind(cfg.sourceKinds);
      const events: RawEvent[] = [];
      const statuses: SourceStatus[] = [];
      for (const s of sources) {
        if (!s.externalId) {
          statuses.push({ key: s.key, state: "failed", lastFetchedAt: null, error: "calendarId(externalId) 없음" });
          continue;
        }
        const outcome = await getCachedPayload<CachedGoogleEvent[]>({
          source: { id: s.id, cacheTtlSeconds: s.cacheTtlSeconds },
          range,
          forceRefresh: opts.forceRefresh,
          now: opts.now,
          fetcher: async () => {
            const client = opts.client ?? getGoogleCalendarClient();
            const evs = await client.listEvents(s.externalId!, range.start, range.end);
            return evs.map(toCached);
          },
        });
        for (const c of outcome.data ?? []) events.push(cachedToRawEvent(c, s.key, cfg.eventKind, cfg.ownerOf(s)));
        statuses.push({ key: s.key, state: outcome.state, lastFetchedAt: outcome.fetchedAt ? outcome.fetchedAt.toISOString() : null, error: outcome.error });
      }
      return { events, statuses };
    },
  };
}
