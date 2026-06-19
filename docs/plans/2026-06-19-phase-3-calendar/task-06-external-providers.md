# Task 06 — 외부 provider (google·holiday) + 캐시

`CalendarSource`(GOOGLE_CALENDAR / HOLIDAY)별로 cache-first 조회하는 provider. 캐시 payload는 **직렬화 가능한 `CachedGoogleEvent[]`**(ISO 문자열)로 저장하고, 읽은 뒤 `RawEvent`로 매핑한다. 공휴일도 Google 공휴일 캘린더라 같은 클라이언트를 쓴다. cache-first 루프는 동일하므로 **공통 팩토리 `createExternalProvider`**(external-shared)에 한 번만 두고, google·holiday는 소스 종류·event kind·owner 귀속만 다른 얇은 래퍼다. provider는 factory로 만들어 `client`·`forceRefresh`를 주입한다.

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
  it("개인 Google 캘린더(ownerUserId) → event.userId로 전파(dedup attribution)", async () => {
    h.sources.mockResolvedValue([{ id: "s1", key: "google-u9", externalId: "u9@group", name: "u9 캘린더", cacheTtlSeconds: 900, ownerUserId: "u9" }]);
    h.getClient.mockReturnValue({
      listEvents: async () => [
        { id: "e1", summary: "회의", description: null, start: new Date("2026-06-12T01:00:00Z"), end: new Date("2026-06-12T02:00:00Z"), allDay: false },
      ],
    });
    cacheRunsFetcher();

    const out = await createGoogleProvider().fetchEvents(range, ctx);
    expect(h.sources).toHaveBeenCalledWith(["GOOGLE_CALENDAR"]);
    expect(out.events[0]).toEqual({
      id: "google-u9:e1",
      kind: "EXTERNAL_EVENT",
      title: "회의",
      description: null,
      start: new Date("2026-06-12T01:00:00Z"),
      end: new Date("2026-06-12T02:00:00Z"),
      allDay: false,
      userId: "u9", // ← ownerUserId에서 전파(하드코딩 null 아님)
      sourceKey: "google-u9",
      externalId: "e1",
      dedupStatus: "UNIQUE",
      duplicateOfId: null,
      tentative: false,
    });
    expect(out.statuses[0]).toEqual({ key: "google-u9", state: "ok", lastFetchedAt: "2026-06-19T00:00:00.000Z", error: null });
  });

  it("공유 캘린더(ownerUserId=null) → event.userId=null", async () => {
    h.sources.mockResolvedValue([{ id: "s1", key: "google-team", externalId: "team@group", name: "팀", cacheTtlSeconds: 900, ownerUserId: null }]);
    h.getClient.mockReturnValue({ listEvents: async () => [{ id: "e9", summary: "회의", description: null, start: new Date("2026-06-12T01:00:00Z"), end: new Date("2026-06-12T02:00:00Z"), allDay: false }] });
    cacheRunsFetcher();
    const out = await createGoogleProvider().fetchEvents(range, ctx);
    expect(out.events[0].userId).toBeNull();
  });

  it("calendarId(externalId)는 응답에 새지 않는다 — 이메일형 calId 가드(§9)", async () => {
    // 시드가 만드는 불투명 key + 이메일형 calId(externalId). provider는 key만 응답에 쓰고 externalId는 fetch 대상으로만 써야 한다.
    h.sources.mockResolvedValue([{ id: "s1", key: "google:ab12cd34ef56", externalId: "person@example.com", name: "Google: person@example.com", cacheTtlSeconds: 900, ownerUserId: null }]);
    h.getClient.mockReturnValue({ listEvents: async () => [{ id: "e1", summary: "회의", description: null, start: new Date("2026-06-12T01:00:00Z"), end: new Date("2026-06-12T02:00:00Z"), allDay: false }] });
    cacheRunsFetcher();
    const out = await createGoogleProvider().fetchEvents(range, ctx);
    // 이벤트 id·sourceKey·status.key 어디에도 calId(=externalId, 이메일 가능)가 없어야 함
    expect(JSON.stringify(out)).not.toContain("person@example.com");
    expect(out.events[0].id).toBe("google:ab12cd34ef56:e1");
    expect(out.events[0].sourceKey).toBe("google:ab12cd34ef56");
    expect(out.statuses[0].key).toBe("google:ab12cd34ef56");
  });

  it("summary 없으면 title='외부 일정'", async () => {
    h.sources.mockResolvedValue([{ id: "s1", key: "google-team", externalId: "team@group", name: "팀", cacheTtlSeconds: 900, ownerUserId: null }]);
    h.getClient.mockReturnValue({ listEvents: async () => [{ id: "e2", summary: null, description: null, start: new Date("2026-06-12T01:00:00Z"), end: new Date("2026-06-12T02:00:00Z"), allDay: false }] });
    cacheRunsFetcher();
    const out = await createGoogleProvider().fetchEvents(range, ctx);
    expect(out.events[0].title).toBe("외부 일정");
  });

  it("cache failed → events 없음 + failed status", async () => {
    h.sources.mockResolvedValue([{ id: "s1", key: "google-team", externalId: "team@group", name: "팀", cacheTtlSeconds: 900, ownerUserId: null }]);
    h.cache.mockResolvedValue({ data: null, state: "failed", fetchedAt: null, error: "google 500" });
    const out = await createGoogleProvider().fetchEvents(range, ctx);
    expect(out.events).toEqual([]);
    expect(out.statuses[0]).toEqual({ key: "google-team", state: "failed", lastFetchedAt: null, error: "google 500" });
  });

  it("forceRefresh가 getCachedPayload로 전달", async () => {
    h.sources.mockResolvedValue([{ id: "s1", key: "google-team", externalId: "team@group", name: "팀", cacheTtlSeconds: 900, ownerUserId: null }]);
    h.getClient.mockReturnValue({ listEvents: async () => [] });
    cacheRunsFetcher();
    await createGoogleProvider({ forceRefresh: true }).fetchEvents(range, ctx);
    expect(h.cache).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }));
  });

  it("externalId 없는 source → failed status, fetch 안 함", async () => {
    h.sources.mockResolvedValue([{ id: "s1", key: "google-broken", externalId: null, name: "x", cacheTtlSeconds: 900, ownerUserId: null }]);
    const out = await createGoogleProvider().fetchEvents(range, ctx);
    expect(out.statuses[0].state).toBe("failed");
    expect(h.cache).not.toHaveBeenCalled();
  });
});

describe("createHolidayProvider", () => {
  it("HOLIDAY source → HOLIDAY kind, summary→title, userId=null", async () => {
    h.sources.mockResolvedValue([{ id: "h1", key: "holiday-kr", externalId: "ko@holiday", name: "대한민국 공휴일", cacheTtlSeconds: 86400, ownerUserId: null }]);
    h.getClient.mockReturnValue({ listEvents: async () => [{ id: "n1", summary: "신정", description: null, start: new Date("2026-01-01T00:00:00+09:00"), end: new Date("2026-01-02T00:00:00+09:00"), allDay: true }] });
    cacheRunsFetcher();
    const out = await createHolidayProvider().fetchEvents(range, ctx);
    expect(h.sources).toHaveBeenCalledWith(["HOLIDAY"]);
    expect(out.events[0]).toMatchObject({ id: "holiday-kr:n1", kind: "HOLIDAY", title: "신정", allDay: true, sourceKey: "holiday-kr", userId: null });
  });
});
```

실행(FAIL): `npm test -- tests/modules/calendar/sources/external.test.ts`

### 2. 구현 (PASS 확인)

`src/modules/calendar/sources/external-shared.ts`:

```ts
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
```

`src/modules/calendar/sources/google.ts`:

```ts
import type { CalendarSourceProvider } from "../types";
import { createExternalProvider, type ExternalProviderOpts } from "./external-shared";

// 얇은 래퍼 — cache-first 루프는 external-shared의 createExternalProvider에 있다(중복 제거).
export function createGoogleProvider(opts: ExternalProviderOpts = {}): CalendarSourceProvider {
  return createExternalProvider(opts, {
    key: "google",
    sourceKinds: ["GOOGLE_CALENDAR"],
    eventKind: "EXTERNAL_EVENT",
    ownerOf: (s) => s.ownerUserId, // 개인 Google 소스의 ownerUserId를 event.userId로 전파(dedup attribution §10)
  });
}
```

`src/modules/calendar/sources/holiday.ts`:

```ts
import type { CalendarSourceProvider } from "../types";
import { createExternalProvider, type ExternalProviderOpts } from "./external-shared";

// 얇은 래퍼 — 공휴일도 Google 공휴일 캘린더라 같은 루프를 쓴다. owner 없음(전원 공통).
export function createHolidayProvider(opts: ExternalProviderOpts = {}): CalendarSourceProvider {
  return createExternalProvider(opts, {
    key: "holiday",
    sourceKinds: ["HOLIDAY"],
    eventKind: "HOLIDAY",
    ownerOf: () => null,
  });
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
