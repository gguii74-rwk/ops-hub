import { describe, it, expect, vi } from "vitest";
import { buildFeed } from "@/modules/calendar/feed";
import type { CalendarSourceProvider, RawEvent, SourceStatus, FeedContext } from "@/modules/calendar/types";

const range = { start: new Date("2026-05-30T15:00:00Z"), end: new Date("2026-07-11T15:00:00Z") };
const ctx = (p: Partial<FeedContext> = {}): FeedContext => ({ userId: "u1", isOwner: false, permissionKeys: new Set<string>(), ...p });

function raw(p: Partial<RawEvent>): RawEvent {
  return {
    id: "x", kind: "INTERNAL_LEAVE", title: "휴가", description: "사유",
    start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z"),
    allDay: true, userId: "u9", sourceKey: "internalLeave", externalId: null,
    dedupStatus: "UNIQUE", duplicateOfId: null, tentative: false, ...p,
  };
}
const ok = (key: string): SourceStatus => ({ key, state: "ok", lastFetchedAt: null, error: null });

function provider(key: string, events: RawEvent[], statuses: SourceStatus[]): CalendarSourceProvider {
  return { key, fetchEvents: async () => ({ events, statuses }) };
}

describe("buildFeed", () => {
  it("work 뷰: VIEW_SOURCES에 해당하는 provider만 호출하고 병합·마스킹", async () => {
    const providers = {
      workflowTask: provider("workflowTask", [raw({ id: "w1", kind: "WORKFLOW_TASK", title: "주간보고", userId: null, description: null })], [ok("workflowTask")]),
      internalLeave: provider("internalLeave", [raw({ id: "l1", userId: "u9" })], [ok("internalLeave")]),
      holiday: provider("holiday", [raw({ id: "h1", kind: "HOLIDAY", title: "신정", userId: null, description: null })], [ok("holiday")]),
      // google/manual은 work 뷰에 없음 → 호출 안 됨
      google: provider("google", [raw({ id: "should-not-appear" })], [ok("google")]),
    };
    const res = await buildFeed("work", range, ctx({ userId: "u1" }), providers);
    const ids = res.events.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["w1", "l1", "h1"]));
    expect(ids).not.toContain("should-not-appear");
    // 타인 휴가는 마스킹
    expect(res.events.find((e) => e.id === "l1")!.masked).toBe(true);
    expect(res.events.find((e) => e.id === "l1")!.description).toBeNull();
    expect(res.sources.map((s) => s.key)).toEqual(expect.arrayContaining(["workflowTask", "internalLeave", "holiday"]));
  });

  it("leave 뷰: DUPLICATE_OF_INTERNAL은 접힘(미표시)", async () => {
    const providers = {
      internalLeave: provider("internalLeave", [raw({ id: "leave:l1", userId: "u9", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-12T00:00:00Z") })], [ok("internalLeave")]),
      google: provider("google", [raw({ id: "google:g1", kind: "EXTERNAL_EVENT", title: "연차", userId: "u9", allDay: true, start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z"), sourceKey: "google-team" })], [ok("google-team")]),
      holiday: provider("holiday", [], [ok("holiday-kr")]),
    };
    const res = await buildFeed("leave", range, ctx({ userId: "u1", permissionKeys: new Set(["calendar.admin:view"]) }), providers);
    expect(res.events.map((e) => e.id)).toContain("leave:l1");
    expect(res.events.map((e) => e.id)).not.toContain("google:g1"); // 접힘
  });

  it("admin 뷰: DUPLICATE_OF_INTERNAL도 표시", async () => {
    const providers = {
      internalLeave: provider("internalLeave", [raw({ id: "leave:l1", userId: "u9", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-12T00:00:00Z") })], [ok("internalLeave")]),
      workflowTask: provider("workflowTask", [], [ok("workflowTask")]),
      manual: provider("manual", [], [ok("manual")]),
      google: provider("google", [raw({ id: "google:g1", kind: "EXTERNAL_EVENT", title: "연차", userId: "u9", allDay: true, start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z"), sourceKey: "google-team" })], [ok("google-team")]),
      holiday: provider("holiday", [], [ok("holiday-kr")]),
    };
    const res = await buildFeed("admin", range, ctx({ userId: "u1", isOwner: true }), providers);
    expect(res.events.map((e) => e.id)).toContain("google:g1");
    expect(res.events.find((e) => e.id === "google:g1")!.dedupStatus).toBe("DUPLICATE_OF_INTERNAL");
  });

  it("stale/failed status 집계 + 원본 에러 sanitize(서버 로그만)", async () => {
    const providers = {
      workflowTask: provider("workflowTask", [], [ok("workflowTask")]),
      internalLeave: provider("internalLeave", [], [{ key: "internalLeave", state: "failed", lastFetchedAt: null, error: "ECONNREFUSED 10.0.0.5:5432" }]),
      holiday: provider("holiday", [], [{ key: "holiday-kr", state: "stale", lastFetchedAt: "2026-06-18T00:00:00.000Z", error: "google 500" }]),
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await buildFeed("work", range, ctx(), providers);
    expect(res.failedSources).toEqual(["internalLeave"]);
    expect(res.staleSources).toEqual(["holiday-kr"]);
    // 클라이언트向 메시지는 일반화, 원본(DB 주소 등)은 노출 안 함
    const failed = res.sources.find((s) => s.key === "internalLeave")!;
    expect(failed.error).toBe("일정을 불러오지 못했습니다.");
    expect(failed.error).not.toContain("ECONNREFUSED");
    expect(spy).toHaveBeenCalled();
    // stale 브랜치도 동일하게 sanitize — "google 500"이 클라이언트에 노출되면 안 됨
    const stale = res.sources.find((s) => s.key === "holiday-kr")!;
    expect(stale.error).toBe("최신 동기화에 실패해 이전 데이터를 표시합니다.");
    expect(stale.error).not.toContain("google 500");
    spy.mockRestore();
  });

  it("tentative(PENDING) 휴가: 본인엔 노출, 타인엔 제외(마스킹 아님), admin엔 노출", async () => {
    const providers = {
      internalLeave: provider("internalLeave", [
        raw({ id: "leave:mine", userId: "u1", tentative: true }),
        raw({ id: "leave:other", userId: "u9", tentative: true }),
      ], [ok("internalLeave")]),
      workflowTask: provider("workflowTask", [], [ok("workflowTask")]),
      holiday: provider("holiday", [], [ok("holiday")]),
    };
    const mine = await buildFeed("work", range, ctx({ userId: "u1" }), providers);
    expect(mine.events.map((e) => e.id)).toContain("leave:mine"); // 본인 미승인은 보임
    expect(mine.events.map((e) => e.id)).not.toContain("leave:other"); // 타인 미승인은 아예 제외(마스킹 아님)

    const adminFeed = await buildFeed("work", range, ctx({ userId: "u1", permissionKeys: new Set(["calendar.admin:view"]) }), providers);
    expect(adminFeed.events.map((e) => e.id)).toContain("leave:other"); // admin은 봄
  });

  it("personal 뷰: 본인 소유 + 공휴일만, 타인 휴가/팀 일정은 제외(마스킹 아님)", async () => {
    const providers = {
      internalLeave: provider("internalLeave", [
        raw({ id: "leave:mine", userId: "u1" }),
        raw({ id: "leave:other", userId: "u9" }),
      ], [ok("internalLeave")]),
      manual: provider("manual", [raw({ id: "manual:other", kind: "PERSONAL_EVENT", title: "개인", userId: "u9" })], [ok("manual")]),
      google: provider("google", [
        raw({ id: "google:mine", kind: "EXTERNAL_EVENT", title: "회의", userId: "u1", sourceKey: "google-u1" }),
        raw({ id: "google:team", kind: "EXTERNAL_EVENT", title: "팀 미팅", userId: null, sourceKey: "google-team" }),
      ], [ok("google")]),
      holiday: provider("holiday", [raw({ id: "h1", kind: "HOLIDAY", title: "신정", description: null, userId: null })], [ok("holiday")]),
    };
    const res = await buildFeed("personal", range, ctx({ userId: "u1" }), providers);
    const ids = res.events.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["leave:mine", "google:mine", "h1"]));
    expect(ids).not.toContain("leave:other"); // 타인 휴가 제외
    expect(ids).not.toContain("google:team"); // 팀 google(userId 없음) 제외
    expect(ids).not.toContain("manual:other"); // 방어적: manual이 타인 걸 줘도 제외
  });

  it("provider가 reject해도 전체는 죽지 않고 failed로 환원", async () => {
    const providers = {
      workflowTask: { key: "workflowTask", fetchEvents: async () => { throw new Error("boom"); } } as CalendarSourceProvider,
      internalLeave: provider("internalLeave", [raw({ id: "l1", userId: "u1" })], [ok("internalLeave")]),
      holiday: provider("holiday", [], [ok("holiday-kr")]),
    };
    const res = await buildFeed("work", range, ctx({ userId: "u1" }), providers);
    expect(res.failedSources).toContain("workflowTask");
    expect(res.events.map((e) => e.id)).toContain("l1");
  });
});
