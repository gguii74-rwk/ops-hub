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

  it("expired + fetcher 실패 + last-good 존재 → stale(옛 payload)", async () => {
    h.read.mockResolvedValue({ payload: { old: true }, fetchedAt: new Date("2026-06-18T00:00:00Z"), expiresAt: new Date("2026-06-18T23:50:00Z"), errorMessage: null });
    const fetcher = vi.fn(async () => { throw new Error("google 500"); });
    const out = await getCachedPayload({ source, range, fetcher, now });
    expect(out.state).toBe("stale");
    expect(out.data).toEqual({ old: true });
    expect(out.error).toBe("google 500");
    expect(h.write).not.toHaveBeenCalled();
  });

  it("엔트리 없음 + fetcher 실패 → failed(data null)", async () => {
    h.read.mockResolvedValue(null);
    const fetcher = vi.fn(async () => { throw new Error("auth fail"); });
    const out = await getCachedPayload({ source, range, fetcher, now });
    expect(out).toMatchObject({ state: "failed", data: null, error: "auth fail", fetchedAt: null });
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

  const entry = await readCacheEntry(source.id, range);

  // 해머링 차단: 강제 새로고침이라도 최근 재검증분이 있으면 그대로 제공.
  if (forceRefresh && entry && current.getTime() - entry.fetchedAt.getTime() < MIN_REFRESH_INTERVAL_SEC * 1000) {
    return {
      data: entry.payload as T,
      state: entry.errorMessage ? "stale" : "ok",
      fetchedAt: entry.fetchedAt,
      error: entry.errorMessage,
    };
  }

  const fresh = entry !== null && entry.errorMessage === null && entry.expiresAt.getTime() > current.getTime();
  if (fresh && !forceRefresh) {
    return { data: entry!.payload as T, state: "ok", fetchedAt: entry!.fetchedAt, error: null };
  }

  // expired / forceRefresh / 엔트리 없음 → 인라인 재검증
  try {
    const data = await fetcher();
    const expiresAt = new Date(current.getTime() + source.cacheTtlSeconds * 1000);
    await writeCacheEntry(source.id, range, data, expiresAt, null);
    return { data, state: "ok", fetchedAt: current, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (entry) {
      // last-good 유지(덮어쓰지 않음) → stale 반환.
      return { data: entry.payload as T, state: "stale", fetchedAt: entry.fetchedAt, error };
    }
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

- `npm test -- tests/modules/calendar/cache.test.ts` → 7케이스 PASS.
- `npm run typecheck` / `npm run lint` → OK.

## Cautions

- **fetcher 실패 시 last-good payload를 error 행으로 덮어쓰지 말 것.** 이유: 마지막 정상 캐시를 잃으면 stale-serving이 불가능해진다. 실패는 반환값으로만 표현하고 기록은 건드리지 않는다.
- **백그라운드 비동기 재검증(서버에서 fire-and-forget) 추가 금지.** 이유: 워커 없는 serverless에서 응답 후 실행이 보장되지 않는다(§12.3). Phase 3는 인라인 재검증만.
- **`Date.now()`를 직접 부르지 말 것.** 이유: 테스트 결정성. 항상 주입된 `now()`를 쓴다.
