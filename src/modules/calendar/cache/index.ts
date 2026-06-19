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

// 같은 source+range에 대한 진행 중 재검증을 묶는 in-process 맵 — 동시 미스가 모두 fetcher를 호출하는
// 스탬피드를 막는다(적대적 리뷰 F1). expiresAt 기반 throttle은 첫 write 이후에야 효력이 생기므로,
// fetch 진행 창(네트워크 수 초) 동안 도착한 동시 요청은 이 맵으로 1회 fetch에 합류시킨다.
// 한계: 프로세스 메모리라 단일 인스턴스에서만 유효(다중 인스턴스는 인스턴스당 1회로 bounded — 현 배포는 단일 인스턴스).
const inFlight = new Map<string, Promise<CacheOutcome<unknown>>>();

function rangeKey(sourceId: string, range: NormalizedRange): string {
  return `${sourceId}|${range.start.getTime()}|${range.end.getTime()}`;
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

  // due(만료 / 엔트리 없음 / forceRefresh가 min-interval 경과) → 동시 미스는 1회 재검증으로 합류.
  // write가 fetch 프로미스 내부에 있어, 리더의 write가 보이는 시점과 맵 해제 시점이 순서대로 정렬된다
  // (write 완료 전 read → 맵 적중해 합류 / write 완료 후 read → fresh 적중해 early-return). 둘 사이 빈틈 없음.
  const key = rangeKey(source.id, range);
  const existing = inFlight.get(key);
  if (existing) return (await existing) as CacheOutcome<T>;

  const revalidate = (async (): Promise<CacheOutcome<unknown>> => {
    try {
      const data = await fetcher();
      const expiresAt = new Date(current.getTime() + source.cacheTtlSeconds * 1000);
      await writeCacheEntry(source.id, range, data, expiresAt, null);
      return { data, state: "ok", fetchedAt: current, error: null };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const retryAt = new Date(current.getTime() + backoffMs);
      const lastGood = entry && entry.payload !== null ? entry.payload : null;
      if (lastGood !== null) {
        // warm: last-good payload는 보존하되 expiresAt를 backoff로 당기고 errorMessage 기록 → stale + 재fetch 폭주 차단.
        await writeCacheEntry(source.id, range, lastGood, retryAt, error);
        return { data: lastGood, state: "stale", fetchedAt: current, error };
      }
      // cold: 성공 이력 없음 → payload null 마커 + 짧은 backoff → failed. 직후 요청/forceRefresh 모두 재fetch 안 함.
      await writeCacheEntry(source.id, range, null, retryAt, error);
      return { data: null, state: "failed", fetchedAt: null, error };
    }
  })();
  inFlight.set(key, revalidate);
  try {
    return (await revalidate) as CacheOutcome<T>;
  } finally {
    inFlight.delete(key);
  }
}
