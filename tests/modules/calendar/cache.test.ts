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

  it("동시 미스(같은 source+range) → fetcher 1회만 실행하고 결과 공유(스탬피드 차단)", async () => {
    // 두 요청이 첫 write 이전에 도착 → 둘 다 due 판정. in-flight 코얼레싱이 없으면 fetcher가 2번 불린다(적대적 리뷰 F1).
    h.read.mockResolvedValue(null); // 엔트리 없음 → 항상 due
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetcher = vi.fn(async () => { await gate; return { v: 1 }; });
    const p1 = getCachedPayload({ source, range, fetcher, now });
    const p2 = getCachedPayload({ source, range, fetcher, now });
    release();
    const [o1, o2] = await Promise.all([p1, p2]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(o1).toMatchObject({ state: "ok", data: { v: 1 } });
    expect(o2).toMatchObject({ state: "ok", data: { v: 1 } });
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it("서로 다른 range는 코얼레싱되지 않는다(각자 fetch)", async () => {
    h.read.mockResolvedValue(null);
    const range2 = { start: new Date("2026-06-30T15:00:00Z"), end: new Date("2026-08-11T15:00:00Z") };
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetcher = vi.fn(async () => { await gate; return { v: 1 }; });
    const p1 = getCachedPayload({ source, range, fetcher, now });
    const p2 = getCachedPayload({ source, range: range2, fetcher, now });
    release();
    await Promise.all([p1, p2]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
