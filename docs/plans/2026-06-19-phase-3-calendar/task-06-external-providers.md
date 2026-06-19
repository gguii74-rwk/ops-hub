# Task 06 — 외부 provider (google·holiday) + 캐시

`CalendarSource`(GOOGLE_CALENDAR / HOLIDAY)별로 cache-first 조회하는 provider. 캐시 payload는 **직렬화 가능한 `CachedGoogleEvent[]`**(ISO 문자열)로 저장하고, 읽은 뒤 `RawEvent`로 매핑한다. 공휴일도 Google 공휴일 캘린더라 같은 클라이언트를 쓴다. provider는 **factory**로 만들어 `client`·`forceRefresh`를 주입한다.

## Files

- Create: `src/modules/calendar/sources/external-shared.ts`
- Create: `src/modules/calendar/sources/google.ts`
- Create: `src/modules/calendar/sources/holiday.ts`
- Test: `tests/modules/calendar/sources/external.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts: `RawEvent`, `SourceResult`, cache `getCachedPayload`, Google `NormalizedGoogleEvent`/`GoogleCalendarClient`/`getGoogleCalendarClient`, repository `findSourcesByKind`.
- Spec §3(공휴일=Google 공휴일 캘린더), §12(캐시·정규화 range).

## Deps

01, 02 (findSourcesByKind), 03 (getCachedPayload), 04 (Google client).

## Steps

### 1. 테스트 먼저 (FAIL 확인)

`tests/modules/calendar/sources/external.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ sources: vi.fn(), cache: vi.fn(), getClient: vi.fn() }));
vi.mock("@/modules/calendar/repositories", () => ({ findSourcesByKind: h.sources }));
vi.mock("@/modules/calendar/cache", () => ({ getCachedPayload: h.cache }));
vi.mock("@/lib/integrations/google", () => ({ getGoogleCalendarClient: h.getClient }));

import { createGoogleProvider } from "@/modules/calendar/sources/google";
import { createHolidayProvider } from "@/modules/calendar/sources/holiday";

const range = { start: new Date("2026-05-30T15:00:00Z"), end: new Date("2026-07-11T15:00:00Z") };
const ctx = { userId: "u1", isOwner: false, permissionKeys: new Set<string>() };
const FETCHED = new Date("2026-06-19T00:00:00Z");

// 캐시 mock: 받은 fetcher를 실행해 data로 돌려준다(매핑 경로까지 테스트).
function cacheRunsFetcher() {
  h.cache.mockImplementation(async ({ fetcher }: any) => ({ data: await fetcher(), state: "ok", fetchedAt: FETCHED, error: null }));
}

beforeEach(() => {
  h.sources.mockReset();
  h.cache.mockReset();
  h.getClient.mockReset();
});

describe("createGoogleProvider", () => {
  it("GOOGLE_CALENDAR source별 fetch→cache→EXTERNAL_EVENT RawEvent 매핑", async () => {
    h.sources.mockResolvedValue([{ id: "s1", key: "google-team", externalId: "team@group", name: "팀", cacheTtlSeconds: 900 }]);
    h.getClient.mockReturnValue({
      listEvents: async () => [
        { id: "e1", summary: "회의", description: null, start: new Date("2026-06-12T01:00:00Z"), end: new Date("2026-06-12T02:00:00Z"), allDay: false },
      ],
    });
    cacheRunsFetcher();

    const out = await createGoogleProvider().fetchEvents(range, ctx);
    expect(h.sources).toHaveBeenCalledWith(["GOOGLE_CALENDAR"]);
    expect(out.events[0]).toEqual({
      id: "google-team:e1",
      kind: "EXTERNAL_EVENT",
      title: "회의",
      description: null,
      start: new Date("2026-06-12T01:00:00Z"),
      end: new Date("2026-06-12T02:00:00Z"),
      allDay: false,
      userId: null,
      sourceKey: "google-team",
      externalId: "e1",
      dedupStatus: "UNIQUE",
      duplicateOfId: null,
    });
    expect(out.statuses[0]).toEqual({ key: "google-team", state: "ok", lastFetchedAt: "2026-06-19T00:00:00.000Z", error: null });
  });

  it("summary 없으면 title='외부 일정'", async () => {
    h.sources.mockResolvedValue([{ id: "s1", key: "google-team", externalId: "team@group", name: "팀", cacheTtlSeconds: 900 }]);
    h.getClient.mockReturnValue({ listEvents: async () => [{ id: "e2", summary: null, description: null, start: new Date("2026-06-12T01:00:00Z"), end: new Date("2026-06-12T02:00:00Z"), allDay: false }] });
    cacheRunsFetcher();
    const out = await createGoogleProvider().fetchEvents(range, ctx);
    expect(out.events[0].title).toBe("외부 일정");
  });

  it("cache failed → events 없음 + failed status", async () => {
    h.sources.mockResolvedValue([{ id: "s1", key: "google-team", externalId: "team@group", name: "팀", cacheTtlSeconds: 900 }]);
    h.cache.mockResolvedValue({ data: null, state: "failed", fetchedAt: null, error: "google 500" });
    const out = await createGoogleProvider().fetchEvents(range, ctx);
    expect(out.events).toEqual([]);
    expect(out.statuses[0]).toEqual({ key: "google-team", state: "failed", lastFetchedAt: null, error: "google 500" });
  });

  it("forceRefresh가 getCachedPayload로 전달", async () => {
    h.sources.mockResolvedValue([{ id: "s1", key: "google-team", externalId: "team@group", name: "팀", cacheTtlSeconds: 900 }]);
    h.getClient.mockReturnValue({ listEvents: async () => [] });
    cacheRunsFetcher();
    await createGoogleProvider({ forceRefresh: true }).fetchEvents(range, ctx);
    expect(h.cache).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }));
  });

  it("externalId 없는 source → failed status, fetch 안 함", async () => {
    h.sources.mockResolvedValue([{ id: "s1", key: "google-broken", externalId: null, name: "x", cacheTtlSeconds: 900 }]);
    const out = await createGoogleProvider().fetchEvents(range, ctx);
    expect(out.statuses[0].state).toBe("failed");
    expect(h.cache).not.toHaveBeenCalled();
  });
});

describe("createHolidayProvider", () => {
  it("HOLIDAY source → HOLIDAY kind, summary→title", async () => {
    h.sources.mockResolvedValue([{ id: "h1", key: "holiday-kr", externalId: "ko@holiday", name: "대한민국 공휴일", cacheTtlSeconds: 86400 }]);
    h.getClient.mockReturnValue({ listEvents: async () => [{ id: "n1", summary: "신정", description: null, start: new Date("2026-01-01T00:00:00+09:00"), end: new Date("2026-01-02T00:00:00+09:00"), allDay: true }] });
    cacheRunsFetcher();
    const out = await createHolidayProvider().fetchEvents(range, ctx);
    expect(h.sources).toHaveBeenCalledWith(["HOLIDAY"]);
    expect(out.events[0]).toMatchObject({ id: "holiday-kr:n1", kind: "HOLIDAY", title: "신정", allDay: true, sourceKey: "holiday-kr" });
  });
});
```

실행(FAIL): `npm test -- tests/modules/calendar/sources/external.test.ts`

### 2. 구현 (PASS 확인)

`src/modules/calendar/sources/external-shared.ts`:

```ts
import type { CalendarEventKind } from "@prisma/client";
import type { NormalizedGoogleEvent } from "@/lib/integrations/google";
import type { RawEvent } from "../types";

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

export function cachedToRawEvent(c: CachedGoogleEvent, sourceKey: string, kind: CalendarEventKind): RawEvent {
  const fallbackTitle = kind === "HOLIDAY" ? "공휴일" : "외부 일정";
  return {
    id: `${sourceKey}:${c.id}`,
    kind,
    title: c.summary ?? fallbackTitle,
    description: c.description,
    start: new Date(c.start),
    end: new Date(c.end),
    allDay: c.allDay,
    userId: null,
    sourceKey,
    externalId: c.id,
    dedupStatus: "UNIQUE",
    duplicateOfId: null,
  };
}
```

`src/modules/calendar/sources/google.ts`:

```ts
import type { CalendarSourceProvider, FeedContext, NormalizedRange, RawEvent, SourceResult, SourceStatus } from "../types";
import { findSourcesByKind } from "../repositories";
import { getCachedPayload } from "../cache";
import { getGoogleCalendarClient, type GoogleCalendarClient } from "@/lib/integrations/google";
import { toCached, cachedToRawEvent, type CachedGoogleEvent } from "./external-shared";

interface ExternalProviderOpts {
  client?: GoogleCalendarClient;
  forceRefresh?: boolean;
  now?: () => Date;
}

export function createGoogleProvider(opts: ExternalProviderOpts = {}): CalendarSourceProvider {
  return {
    key: "google",
    async fetchEvents(range: NormalizedRange, _ctx: FeedContext): Promise<SourceResult> {
      const sources = await findSourcesByKind(["GOOGLE_CALENDAR"]);
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
        for (const c of outcome.data ?? []) events.push(cachedToRawEvent(c, s.key, "EXTERNAL_EVENT"));
        statuses.push({ key: s.key, state: outcome.state, lastFetchedAt: outcome.fetchedAt ? outcome.fetchedAt.toISOString() : null, error: outcome.error });
      }
      return { events, statuses };
    },
  };
}
```

`src/modules/calendar/sources/holiday.ts`:

```ts
import type { CalendarSourceProvider, FeedContext, NormalizedRange, RawEvent, SourceResult, SourceStatus } from "../types";
import { findSourcesByKind } from "../repositories";
import { getCachedPayload } from "../cache";
import { getGoogleCalendarClient, type GoogleCalendarClient } from "@/lib/integrations/google";
import { toCached, cachedToRawEvent, type CachedGoogleEvent } from "./external-shared";

interface ExternalProviderOpts {
  client?: GoogleCalendarClient;
  forceRefresh?: boolean;
  now?: () => Date;
}

export function createHolidayProvider(opts: ExternalProviderOpts = {}): CalendarSourceProvider {
  return {
    key: "holiday",
    async fetchEvents(range: NormalizedRange, _ctx: FeedContext): Promise<SourceResult> {
      const sources = await findSourcesByKind(["HOLIDAY"]);
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
        for (const c of outcome.data ?? []) events.push(cachedToRawEvent(c, s.key, "HOLIDAY"));
        statuses.push({ key: s.key, state: outcome.state, lastFetchedAt: outcome.fetchedAt ? outcome.fetchedAt.toISOString() : null, error: outcome.error });
      }
      return { events, statuses };
    },
  };
}
```

실행(PASS): `npm test -- tests/modules/calendar/sources/external.test.ts`

### 3. commit

```
git add src/modules/calendar/sources/external-shared.ts src/modules/calendar/sources/google.ts src/modules/calendar/sources/holiday.ts tests/modules/calendar/sources/external.test.ts
git commit -m "calendar: add google/holiday providers (cache-first, factory-injected client)"
```

## Acceptance Criteria

- `npm test -- tests/modules/calendar/sources/external.test.ts` → PASS.
- `npm run typecheck` / `npm run lint` → OK(module이 lib import는 허용 — google client는 lib).

## Cautions

- **`RawEvent`(Date 포함)를 캐시 payload로 저장하지 말 것.** 이유: `CalendarCacheEntry.payload`는 Json이라 Date가 문자열로 깨진다. 직렬화형 `CachedGoogleEvent`(ISO)로 저장하고 읽은 뒤 `cachedToRawEvent`로 복원한다.
- **`getGoogleCalendarClient()`를 모듈 최상위에서 호출하지 말 것.** 이유: import 시점에 service account 자격증명 접근이 일어난다. fetcher 안에서 lazy 호출한다.
- **range를 provider에서 다시 정규화하지 말 것.** 이유: 정규화는 feed/route(Task 08/09)에서 1회 수행하고 캐시 키 일관성을 보장한다. provider는 받은 range를 그대로 쓴다.
