import type { CalendarEventKind } from "@prisma/client";
import { getGoogleCalendarClient, type GoogleCalendarClient, type NormalizedGoogleEvent } from "@/lib/integrations/google";
import { findSourcesByKind, type SourceRow } from "../repositories";
import { getCachedPayload } from "../cache";
import { EXTERNAL_FETCH_TIMEOUT_MS } from "../constants";
import type { CalendarSourceProvider, FeedContext, NormalizedRange, RawEvent, SourceResult, SourceStatus, ViewKey } from "../types";

// 외부 fetch 1건의 상한 — 멈춘 Google 호출이 feed 전체를 막지 않게 한다(적대적 리뷰). 초과 시 reject →
// getCachedPayload의 catch가 stale/failed로 환원. p는 취소되지 않지만(orphan), feed 반환은 보장된다(gaxios timeout이 HTTP 계층 백스톱).
function fetchWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`외부 소스 응답 시간 초과(${ms}ms): ${label}`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

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
  view?: ViewKey; // personal 뷰면 owner 스코프 소스(개인 Google)만 fetch — 타인/공유 소스 fan-out·상태 누출 차단(F2)
}

interface ExternalProviderConfig {
  key: string;
  sourceKinds: Array<"GOOGLE_CALENDAR" | "HOLIDAY">;
  eventKind: CalendarEventKind;
  ownerOf: (s: SourceRow) => string | null; // google=개인 소스 ownerUserId 전파, holiday=항상 null
  ownerScoped?: boolean; // true(google)면 personal 뷰에서 본인 소유 소스로 제한. holiday는 소유 개념 없음 → 항상 전체.
}

// google·holiday provider의 cache-first 루프는 동일하다(소스 종류·event kind·owner 귀속만 다름).
// 중복 복붙 대신 한 팩토리로 둔다(적대적 리뷰 pre-flight). google.ts/holiday.ts는 cfg만 다른 얇은 래퍼.
export function createExternalProvider(opts: ExternalProviderOpts, cfg: ExternalProviderConfig): CalendarSourceProvider {
  return {
    key: cfg.key,
    async fetchEvents(range: NormalizedRange, ctx: FeedContext): Promise<SourceResult> {
      const all = await findSourcesByKind(cfg.sourceKinds);
      // personal 뷰: 본인 소유 소스만 — fetch/캐시 갱신과 status 집계를 owner 스코프로 제한해
      // 저권한 사용자가 타인 Google 캘린더를 갱신시키거나 그 존재·상태를 알게 되는 경로를 차단(F2).
      const sources = cfg.ownerScoped && opts.view === "personal"
        ? all.filter((s) => s.ownerUserId === ctx.userId)
        : all;
      // 소스별 병렬 fetch — 한 캘린더가 느리거나 멈춰도 다른 소스를 직렬로 막지 않는다(N×timeout 방지, 적대적 리뷰).
      // 각 소스는 자기 결과로 격리: 예기치 못한 throw도 allSettled가 그 소스만 failed로 환원(provider 전체는 살아남음).
      const settled = await Promise.allSettled(
        sources.map(async (s): Promise<{ events: RawEvent[]; status: SourceStatus }> => {
          if (!s.externalId) {
            return { events: [], status: { key: s.key, state: "failed", lastFetchedAt: null, error: "calendarId(externalId) 없음" } };
          }
          const outcome = await getCachedPayload<CachedGoogleEvent[]>({
            source: { id: s.id, cacheTtlSeconds: s.cacheTtlSeconds },
            range,
            forceRefresh: opts.forceRefresh,
            now: opts.now,
            fetcher: async () => {
              const client = opts.client ?? getGoogleCalendarClient();
              // 멈춘 Google 호출이 feed 전체를 막지 않도록 소스별 타임아웃 — 초과 시 reject → getCachedPayload가 stale/failed로 환원.
              const evs = await fetchWithTimeout(client.listEvents(s.externalId!, range.start, range.end), EXTERNAL_FETCH_TIMEOUT_MS, s.key);
              return evs.map(toCached);
            },
          });
          const events = (outcome.data ?? []).map((c) => cachedToRawEvent(c, s.key, cfg.eventKind, cfg.ownerOf(s)));
          return { events, status: { key: s.key, state: outcome.state, lastFetchedAt: outcome.fetchedAt ? outcome.fetchedAt.toISOString() : null, error: outcome.error } };
        }),
      );
      const events: RawEvent[] = [];
      const statuses: SourceStatus[] = [];
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") {
          events.push(...r.value.events);
          statuses.push(r.value.status);
        } else {
          // getCachedPayload가 catch 못 한 예외(예: DB 읽기 실패) — 그 소스만 failed로 환원, 나머지는 유지.
          statuses.push({ key: sources[i].key, state: "failed", lastFetchedAt: null, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
        }
      });
      return { events, statuses };
    },
  };
}
