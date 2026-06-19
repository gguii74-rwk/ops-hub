import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  let session: any = { user: { id: "u1" } };
  class FakeForbidden extends Error {}
  return {
    getSession: () => session,
    setSession: (v: any) => { session = v; },
    FakeForbidden,
    requirePermission: vi.fn(async (..._a: unknown[]) => {}),
    getPermissionSummary: vi.fn(async (..._a: unknown[]) => ({ keys: ["calendar.work:view"] })),
    buildFeed: vi.fn(async (..._a: unknown[]) => ({ events: [], sources: [], staleSources: [], failedSources: [] })),
    createProviders: vi.fn((..._a: unknown[]) => ({})),
  };
});

vi.mock("@/lib/auth", () => ({ auth: async () => h.getSession() }));
vi.mock("@/kernel/access", () => ({
  ForbiddenError: h.FakeForbidden,
  requirePermission: (u: string, r: string, a: string) => h.requirePermission(u, r, a),
  getPermissionSummary: (u: string) => h.getPermissionSummary(u),
}));
vi.mock("@/modules/calendar/feed", () => ({ buildFeed: (...a: unknown[]) => (h.buildFeed as (...args: unknown[]) => unknown)(...a) }));
vi.mock("@/modules/calendar/providers", () => ({ createCalendarProviders: (o: unknown) => (h.createProviders as (arg: unknown) => unknown)(o) }));

import { GET } from "@/app/api/calendar/feed/route";
import { POST } from "@/app/api/calendar/refresh/route";

const getReq = (qs: string) => new Request(`http://t/api/calendar/feed?${qs}`);
const postReq = (body: unknown) => new Request("http://t/api/calendar/refresh", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  h.setSession({ user: { id: "u1" } });
  h.requirePermission.mockReset().mockResolvedValue(undefined);
  h.getPermissionSummary.mockReset().mockResolvedValue({ keys: ["calendar.work:view"] });
  h.buildFeed.mockReset().mockResolvedValue({ events: [], sources: [], staleSources: [], failedSources: [] });
  h.createProviders.mockReset().mockReturnValue({});
});

describe("GET /api/calendar/feed", () => {
  it("미인증 → 401", async () => {
    h.setSession(null);
    expect((await GET(getReq("view=work&start=2026-06-15"))).status).toBe(401);
  });

  it("잘못된 view → 400", async () => {
    expect((await GET(getReq("view=nope&start=2026-06-15"))).status).toBe(400);
  });

  it("잘못된 start → 400", async () => {
    expect((await GET(getReq("view=work&start=not-a-date"))).status).toBe(400);
  });

  it("권한 없음 → 403", async () => {
    h.requirePermission.mockRejectedValue(new h.FakeForbidden("denied"));
    expect((await GET(getReq("view=work&start=2026-06-15"))).status).toBe(403);
  });

  it("창 밖 start(먼 과거) → 400", async () => {
    expect((await GET(getReq("view=work&start=1900-01-01"))).status).toBe(400);
  });

  it("성공 → 200, buildFeed에 정규화 range·ctx 전달, no-store", async () => {
    // 앵커는 now 기준 운영 창 안이어야 하므로 현재 시각으로 만든다(고정 날짜는 시간 경과 시 창을 벗어나 테스트가 깨짐).
    const res = await GET(getReq(`view=work&start=${new Date().toISOString()}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(h.requirePermission).toHaveBeenCalledWith("u1", "calendar.work", "view");
    const call = (h.buildFeed.mock.calls[0] as unknown) as [string, { start: Date; end: Date }, { userId: string; permissionKeys: Set<string> }, unknown];
    const [view, range, ctx, providers] = call;
    expect(view).toBe("work");
    // 정규화 정확값은 time.test.ts가 검증 — 여기선 6주(42일) 그리드 불변식만 확인.
    expect((range.end.getTime() - range.start.getTime()) / 86_400_000).toBe(42);
    expect(ctx.userId).toBe("u1");
    expect(ctx.permissionKeys.has("calendar.work:view")).toBe(true);
    expect(h.createProviders).toHaveBeenCalledWith({ forceRefresh: false });
    expect(providers).toBeDefined();
  });
});

describe("POST /api/calendar/refresh", () => {
  it("미인증 → 401", async () => {
    h.setSession(null);
    expect((await POST(postReq({ view: "work", start: "2026-06-15" }))).status).toBe(401);
  });

  it("잘못된 view → 400", async () => {
    expect((await POST(postReq({ view: "nope", start: "2026-06-15" }))).status).toBe(400);
  });

  it("창 밖 start → 400", async () => {
    expect((await POST(postReq({ view: "leave", start: "1900-01-01" }))).status).toBe(400);
  });

  it("성공 → forceRefresh:true provider로 buildFeed, 200", async () => {
    const res = await POST(postReq({ view: "leave", start: new Date().toISOString() }));
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("u1", "calendar.leave", "view");
    expect(h.createProviders).toHaveBeenCalledWith({ forceRefresh: true });
  });
});
