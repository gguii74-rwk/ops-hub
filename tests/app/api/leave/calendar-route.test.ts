import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "u1", systemRole: "MEMBER" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: [] as string[] })),
    getLeaveCalendar: vi.fn(async () => []),
    FakeForbidden,
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...args: unknown[]) => unknown)(...a),
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...args: unknown[]) => unknown)(...a),
  ForbiddenError: h.FakeForbidden,
}));
vi.mock("@/modules/leave/services/calendar", () => ({
  getLeaveCalendar: (...a: unknown[]) => (h.getLeaveCalendar as (...args: unknown[]) => unknown)(...a),
}));

import { GET } from "@/app/api/leave/calendar/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", systemRole: "MEMBER" } });
  h.getPermissionSummary.mockResolvedValue({ keys: [] });
  h.getLeaveCalendar.mockResolvedValue([]);
});

describe("GET /api/leave/calendar", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x/api/leave/calendar"));
    expect(res.status).toBe(401);
  });

  it("happy-path 200 + events 배열 + requirePermission 호출 검증", async () => {
    const res = await GET(new Request("http://x/api/leave/calendar"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(h.requirePermission).toHaveBeenCalledWith("u1", "leave.request", "view");
  });

  it("권한 없음 403", async () => {
    const { ForbiddenError } = await import("@/kernel/access");
    h.requirePermission.mockRejectedValueOnce(new ForbiddenError());
    const res = await GET(new Request("http://x/api/leave/calendar"));
    expect(res.status).toBe(403);
  });

  it("일반 사용자는 canViewAllStatuses=false·canCrossTeam=false, teamId 무시", async () => {
    h.getPermissionSummary.mockResolvedValueOnce({ keys: [] });
    await GET(new Request("http://x/api/leave/calendar?teamId=team1"));
    expect(h.getLeaveCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ canViewAllStatuses: false, canCrossTeam: false, filterTeamId: null }),
    );
  });

  it("status:view는 canCrossTeam=true이지만 canViewAllStatuses=false(전상태·마스킹 해제 금지)", async () => {
    h.getPermissionSummary.mockResolvedValueOnce({ keys: ["leave.status:view"] });
    await GET(new Request("http://x/api/leave/calendar?teamId=team1"));
    expect(h.getLeaveCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ canViewAllStatuses: false, canCrossTeam: true, filterTeamId: "team1" }),
    );
  });

  it("admin:view는 canViewAllStatuses=true·canCrossTeam=true", async () => {
    h.getPermissionSummary.mockResolvedValueOnce({ keys: ["leave.admin:view"] });
    await GET(new Request("http://x/api/leave/calendar"));
    expect(h.getLeaveCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ canViewAllStatuses: true, canCrossTeam: true }),
    );
  });
});
