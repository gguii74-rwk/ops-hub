import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "u1", systemRole: "MEMBER" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: [] as string[] })),
    getEmployeeDashboard: vi.fn(async () => ({ summary: null, usageRate: 0, recentRequests: [] })),
    getAdminDashboard: vi.fn(async () => ({
      totalEmployees: 10,
      todayOnLeave: 1,
      pendingRequests: 2,
      today: [],
      tomorrow: [],
      upcoming: [],
    })),
    FakeForbidden,
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...args: unknown[]) => unknown)(...a),
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...args: unknown[]) => unknown)(...a),
  ForbiddenError: h.FakeForbidden,
}));
vi.mock("@/modules/leave/services/dashboard", () => ({
  getEmployeeDashboard: (...a: unknown[]) => (h.getEmployeeDashboard as (...args: unknown[]) => unknown)(...a),
  getAdminDashboard: (...a: unknown[]) => (h.getAdminDashboard as (...args: unknown[]) => unknown)(...a),
}));

import { GET } from "@/app/api/leave/dashboard/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", systemRole: "MEMBER" } });
  h.getPermissionSummary.mockResolvedValue({ keys: ["leave.request:view"] });
  h.getEmployeeDashboard.mockResolvedValue({ summary: null, usageRate: 0, recentRequests: [] });
  h.getAdminDashboard.mockResolvedValue({
    totalEmployees: 10,
    todayOnLeave: 1,
    pendingRequests: 2,
    today: [],
    tomorrow: [],
    upcoming: [],
  });
});

describe("GET /api/leave/dashboard", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("SC-2: leave.approval:view 단독 보유 시 admin === null (cross-user 게이트 fail-closed)", async () => {
    // approval:view만 있고 status:view·admin:view가 없으면 showAdmin = false → admin null
    h.getPermissionSummary.mockResolvedValueOnce({
      keys: ["leave.request:view", "leave.approval:view"],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.admin).toBeNull();
    expect(h.getAdminDashboard).not.toHaveBeenCalled();
  });

  it("SC-2: leave.status:view 보유 시 admin 블록 채워짐", async () => {
    h.getPermissionSummary.mockResolvedValueOnce({
      keys: ["leave.request:view", "leave.status:view"],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.admin).not.toBeNull();
    expect(h.getAdminDashboard).toHaveBeenCalled();
  });

  it("SC-2: leave.admin:view 보유 시 admin 블록 채워짐", async () => {
    h.getPermissionSummary.mockResolvedValueOnce({
      keys: ["leave.request:view", "leave.admin:view"],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.admin).not.toBeNull();
    expect(h.getAdminDashboard).toHaveBeenCalled();
  });
});
