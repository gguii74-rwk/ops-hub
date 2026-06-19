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
