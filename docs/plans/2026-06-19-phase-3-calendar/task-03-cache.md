# Task 03 — cache 레이어 (TTL·인라인 재검증)

외부 출처용 cache-first 레이어. fresh면 즉시 반환, expired면 fetcher로 인라인 재검증, 실패 시 last-good 있으면 stale·없으면 failed. `forceRefresh`는 `MIN_REFRESH_INTERVAL_SEC` 가드. **Date 주입(`now`)으로 테스트 가능하게 한다.**

## Files

- Create: `src/modules/calendar/cache/index.ts`
- Test: `tests/modules/calendar/cache.test.ts`

## Prep

- Spec §12.3(만료 정책 표준 문구), §12.4(min-refresh-interval).
- 엔트리포인트 §Shared Contracts의 cache 시그니처 + 상수 `MIN_REFRESH_INTERVAL_SEC`.

## Deps

01 (types/constants), 02 (readCacheEntry/writeCacheEntry).

## Steps

### 1. 테스트 먼저 작성 (FAIL 확인)

`tests/modules/calendar/cache.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(async () => {}) }));
vi.mock("@/modules/calendar/repositories", () => ({
  readCacheEntry: h.read,
  writeCacheEntry: h.write,
}));

import { getCachedPayload } from "@/modules/calendar/cache";

const source = { id: "s1", cacheTtlSeconds: 900 };
const range = { start: new Date("2026-05-30T15:00:00Z"), end: new Date("2026-07-11T15:00:00Z") };
const CURRENT = new Date("2026-06-19T00:00:00Z");
const now = () => CURRENT;

beforeEach(() => {
  h.read.mockReset();
  h.write.mockReset().mockResolvedValue(undefined);
});

describe("getCachedPayload", () => {
  it("fresh: fetcher 미호출, ok 반환", async () => {
    h.read.mockResolvedValue({ payload: { e: 1 }, fetchedAt: CURRENT, expiresAt: new Date("2026-06-19T00:10:00Z"), errorMessage: null });
    const fetcher = vi.fn();
    const out = await getCachedPayload({ source, range, fetcher, now });
    expect(out.state).toBe("ok");
    expect(out.data).toEqual({ e: 1 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("expired: fetcher 호출 + write + ok(새 데이터)", async () => {
    h.read.mockResolvedValue({ payload: { old: true }, fetchedAt: new Date("2026-06-18T00:00:00Z"), expiresAt: new Date("2026-06-18T23:50:00Z"), errorMessage: null });
    const fetcher = vi.fn(async () => ({ fresh: true }));
    const out = await getCachedPayload({ source, range, fetcher, now });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ state: "ok", data: { fresh: true }, error: null });
    expect(h.write).toHaveBeenCalledWith(
      "s1",
      range,
      { fresh: true },
      new Date(CURRENT.getTime() + 900_000),
      null,
    );
  });

  it("expired + fetcher 실패 + last-good 존재 → stale(옛 payload) + 짧은 backoff 기록(payload 보존)", async () => {
    h.read.mockResolvedValue({ payload: { old: true }, fetchedAt: new Date("2026-06-18T00:00:00Z"), expiresAt: new Date("2026-06-18T23:50:00Z"), errorMessage: null });
    const fetcher = vi.fn(async () => { throw new Error("google 500"); });
    const out = await getCachedPayload({ source, range, fetcher, now });
    expect(out.state).toBe("stale");
    expect(out.data).toEqual({ old: true });
    expect(out.error).toBe("google 500");
    // last-good payload는 보존하되 expiresAt을 current+MIN_REFRESH_INTERVAL로 당겨 직후 재요청이 재fetch 안 하게 함.
    expect(h.write).toHaveBeenCalledWith("s1", range, { old: true }, new Date(CURRENT.getTime() + 30_000), "google 500");
  });

  it("warm 실패 backoff 후 즉시 재요청(min-interval 내) → 재fetch 없이 stale 유지(장애 증폭 차단)", async () => {
    // 직전 warm 실패가 남긴 backoff 엔트리: last-good 보존 + 가까운 미래 expiresAt + errorMessage
    h.read.mockResolvedValue({ payload: { old: true }, fetchedAt: new Date(CURRENT.getTime() - 5_000), expiresAt: new Date(CURRENT.getTime() + 25_000), errorMessage: "google 500" });
    const fetcher = vi.fn();
    const out = await getCachedPayload({ source, range, fetcher, now });
    expect(fetcher).not.toHaveBeenCalled();
    expect(out).toMatchObject({ state: "stale", data: { old: true }, error: "google 500" });
  });

  it("엔트리 없음 + fetcher 실패 → failed(data null) + cold 실패 마커(payload null) 기록", async () => {
    h.read.mockResolvedValue(null);
    const fetcher = vi.fn(async () => { throw new Error("auth fail"); });
    const out = await getCachedPayload({ source, range, fetcher, now });
    expect(out).toMatchObject({ state: "failed", data: null, error: "auth fail", fetchedAt: null });
    // cold 마커: payload null(warm과 구분), backoff(current+30s) 만료, errorMessage 세팅 → 직후 요청/forceRefresh 모두 throttle됨
    expect(h.write).toHaveBeenCalledWith("s1", range, null, new Date(CURRENT.getTime() + 30_000), "auth fail");
  });

  it("cold 실패 마커(payload null) 후 forceRefresh가 min-interval 내면 재요청 안 함(failed 유지)", async () => {
    h.read.mockResolvedValue({ payload: null, fetchedAt: new Date(CURRENT.getTime() - 10_000), expiresAt: new Date(CURRENT.getTime() + 20_000), errorMessage: "auth fail" });
    const fetcher = vi.fn();
    const out = await getCachedPayload({ source, range, fetcher, now, forceRefresh: true });
    expect(fetcher).not.toHaveBeenCalled();
    expect(out).toMatchObject({ state: "failed", data: null });
  });

  it("엔트리 없음 + fetcher 성공 → write + ok", async () => {
    h.read.mockResolvedValue(null);
    const fetcher = vi.fn(async () => [1, 2, 3]);
    const out = await getCachedPayload({ source, range, fetcher, now });
    expect(out).toMatchObject({ state: "ok", data: [1, 2, 3] });
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it("forceRefresh지만 min-interval 내 → fetcher 미호출(해머링 차단)", async () => {
    h.read.mockResolvedValue({ payload: { e: 1 }, fetchedAt: new Date(CURRENT.getTime() - 10_000), expiresAt: new Date("2026-06-18T23:50:00Z"), errorMessage: null });
    const fetcher = vi.fn();
    const out = await getCachedPayload({ source, range, fetcher, now, forceRefresh: true });
    expect(fetcher).not.toHaveBeenCalled();
    expect(out.data).toEqual({ e: 1 });
  });

  it("forceRefresh + min-interval 경과 → fresh여도 fetcher 호출", async () => {
    h.read.mockResolvedValue({ payload: { e: 1 }, fetchedAt: new Date(CURRENT.getTime() - 60_000), expiresAt: new Date("2026-06-19T00:10:00Z"), errorMessage: null });
    const fetcher = vi.fn(async () => ({ e: 2 }));
    const out = await getCachedPayload({ source, range, fetcher, now, forceRefresh: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(out.data).toEqual({ e: 2 });
  });
});
```

실행(FAIL): `npm test -- tests/modules/calendar/cache.test.ts`

### 2. 구현 (PASS 확인)

`src/modules/calendar/cache/index.ts`:

```ts
import { MIN_REFRESH_INTERVAL_SEC } from "../constants";
import type { NormalizedRange } from "../types";
import { readCacheEntry, writeCacheEntry } from "../repositories";

export interface CacheOutcome<T> {
  data: T | null;
  state: "ok" | "stale" | "failed";
  fetchedAt: Date | null;
  error: string | null;
}

// 저장된 엔트리를 재fetch 없이 그대로 환원(만료 전·백오프 중에 호출).
// errorMessage 없으면 ok. 있으면 last-good 보존분(warm, payload≠null)은 stale, cold(payload=null)는 failed.
function outcomeFromEntry<T>(entry: { payload: unknown; fetchedAt: Date; errorMessage: string | null }): CacheOutcome<T> {
  if (entry.errorMessage === null) {
    return { data: entry.payload as T, state: "ok", fetchedAt: entry.fetchedAt, error: null };
  }
  if (entry.payload !== null) {
    return { data: entry.payload as T, state: "stale", fetchedAt: entry.fetchedAt, error: entry.errorMessage };
  }
  return { data: null, state: "failed", fetchedAt: null, error: entry.errorMessage };
}

export async function getCachedPayload<T>(args: {
  source: { id: string; cacheTtlSeconds: number };
  range: NormalizedRange;
  fetcher: () => Promise<T>;
  now?: () => Date;
  forceRefresh?: boolean;
}): Promise<CacheOutcome<T>> {
  const { source, range, fetcher, forceRefresh = false } = args;
  const now = args.now ?? (() => new Date());
  const current = now();
  const backoffMs = MIN_REFRESH_INTERVAL_SEC * 1000;

  const entry = await readCacheEntry(source.id, range);

  // expiresAt = '다음 재시도 가능 시각'으로 통일(성공=+TTL, 실패(warm/cold)=+MIN_REFRESH_INTERVAL).
  // 아직 만료 전이면(성공이든 실패 백오프든) 재fetch하지 않고 그대로 제공 → 장애 지속 시 매 요청 Google 연타 차단(적대적 리뷰 Finding 2).
  if (entry && current.getTime() < entry.expiresAt.getTime() && !forceRefresh) {
    return outcomeFromEntry<T>(entry);
  }
  // 강제 새로고침이라도 최근 시도(성공·실패 무관)가 min-interval 내면 그대로 제공(해머링 차단).
  if (forceRefresh && entry && current.getTime() - entry.fetchedAt.getTime() < backoffMs) {
    return outcomeFromEntry<T>(entry);
  }

  // due(만료 / 엔트리 없음 / forceRefresh가 min-interval 경과) → 인라인 재검증
  try {
    const data = await fetcher();
    const expiresAt = new Date(current.getTime() + source.cacheTtlSeconds * 1000);
    await writeCacheEntry(source.id, range, data, expiresAt, null);
    return { data, state: "ok", fetchedAt: current, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const retryAt = new Date(current.getTime() + backoffMs);
    const lastGood = entry && entry.payload !== null ? (entry.payload as T) : null;
    if (lastGood !== null) {
      // warm: last-good payload는 보존하되 expiresAt를 backoff로 당기고 errorMessage 기록 → stale + 재fetch 폭주 차단.
      await writeCacheEntry(source.id, range, lastGood, retryAt, error);
      return { data: lastGood, state: "stale", fetchedAt: current, error };
    }
    // cold: 성공 이력 없음 → payload null 마커 + 짧은 backoff → failed. 직후 요청/forceRefresh 모두 재fetch 안 함.
    await writeCacheEntry(source.id, range, null, retryAt, error);
    return { data: null, state: "failed", fetchedAt: null, error };
  }
}
```

실행(PASS): `npm test -- tests/modules/calendar/cache.test.ts`

### 3. commit

```
git add src/modules/calendar/cache tests/modules/calendar/cache.test.ts
git commit -m "calendar: add cache layer (inline-revalidate, stale fallback, min-interval)"
```

## Acceptance Criteria

- `npm test -- tests/modules/calendar/cache.test.ts` → 9케이스 PASS.
- `npm run typecheck` / `npm run lint` → OK.

## Cautions

- **warm 실패 시 last-good *payload*를 덮어쓰지 말 것.** 이유: 마지막 정상 캐시를 잃으면 stale-serving이 불가능해진다. warm 실패는 payload는 그대로 두되 `expiresAt`만 current+MIN_REFRESH_INTERVAL로 당기고 errorMessage를 기록한다 — 그래야 만료 후 장애가 지속돼도 매 요청 재fetch하지 않는다(적대적 리뷰 Finding 2). cold 실패는 payload `null` 마커로 같은 backoff를 기록(별개 경로).
- **`fetchedAt`을 '마지막 성공'으로 가정하지 말 것.** 이유: 실패 backoff 기록 시에도 `writeCacheEntry`가 fetchedAt를 갱신하므로 이 값은 '마지막 *시도*' 시각이다. min-interval 가드와 `SourceStatus.lastFetchedAt` 표시는 이 의미를 전제로 한다.
- **warm vs cold를 payload 내용으로 구분할 때 `null`만 cold로 볼 것.** 이유: 정상 빈 결과(`[]`)는 warm(last-good)이다. cold 마커만 `null`(`Prisma.JsonNull`)로 기록되므로 `payload !== null`이 warm 판정이다.
- **백그라운드 비동기 재검증(서버에서 fire-and-forget) 추가 금지.** 이유: 워커 없는 serverless에서 응답 후 실행이 보장되지 않는다(§12.3). Phase 3는 인라인 재검증만.
- **`Date.now()`를 직접 부르지 말 것.** 이유: 테스트 결정성. 항상 주입된 `now()`를 쓴다.
