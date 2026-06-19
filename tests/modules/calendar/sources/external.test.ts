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

  it("personal 뷰: 본인 소유 Google 소스만 fetch — 타인·공유 소스는 외부 호출·상태 누출 없음(트러스트 경계, F2)", async () => {
    h.sources.mockResolvedValue([
      { id: "s1", key: "google:mine", externalId: "mine@cal", name: "내 캘린더", cacheTtlSeconds: 900, ownerUserId: "u1" },
      { id: "s2", key: "google:other", externalId: "other@cal", name: "타인 캘린더", cacheTtlSeconds: 900, ownerUserId: "u9" },
      { id: "s3", key: "google:team", externalId: "team@cal", name: "공유 캘린더", cacheTtlSeconds: 900, ownerUserId: null },
    ]);
    h.getClient.mockReturnValue({ listEvents: async () => [] });
    cacheRunsFetcher();
    const out = await createGoogleProvider({ view: "personal" }).fetchEvents(range, ctx);
    // 본인 소스(s1)만 외부 fetch — 타인(s2)·공유(s3)는 getCachedPayload조차 호출 안 됨
    expect(h.cache).toHaveBeenCalledTimes(1);
    expect(out.statuses.map((s) => s.key)).toEqual(["google:mine"]);
    const json = JSON.stringify(out);
    expect(json).not.toContain("google:other");
    expect(json).not.toContain("google:team");
  });

  it("leave 뷰: 전체 Google 소스 fetch(팀 휴가 보조 데이터) — personal 외 view는 owner 스코프 안 함", async () => {
    h.sources.mockResolvedValue([
      { id: "s1", key: "google:mine", externalId: "mine@cal", name: "내", cacheTtlSeconds: 900, ownerUserId: "u1" },
      { id: "s2", key: "google:other", externalId: "other@cal", name: "타인", cacheTtlSeconds: 900, ownerUserId: "u9" },
    ]);
    h.getClient.mockReturnValue({ listEvents: async () => [] });
    cacheRunsFetcher();
    const out = await createGoogleProvider({ view: "leave" }).fetchEvents(range, ctx);
    expect(h.cache).toHaveBeenCalledTimes(2);
    expect(out.statuses.map((s) => s.key).sort()).toEqual(["google:mine", "google:other"]);
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
