import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    permission: { findUnique: vi.fn(), findMany: vi.fn() },
    userPermissionOverride: { findMany: vi.fn() },
    rolePermission: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { getPermissionSummary, hasPermission, requirePermission, ForbiddenError } from "@/kernel/access";

beforeEach(() => {
  vi.clearAllMocks();
  h.db.user.findUnique.mockResolvedValue({ systemRole: "MEMBER", status: "ACTIVE", mustChangePassword: false, roleAssignments: [{ roleId: "r1", startsAt: null, endsAt: null }] });
  h.db.permission.findMany.mockResolvedValue([{ id: "p1", resource: "leave.approval", action: "view" }]);
  h.db.permission.findUnique.mockResolvedValue({ id: "p1" });
  h.db.userPermissionOverride.findMany.mockResolvedValue([]);
  h.db.rolePermission.findMany.mockResolvedValue([{ permissionId: "p1", effect: "ALLOW", scope: "team" }]);
});

describe("D5/F2 — 메뉴 노출 ≠ 데이터 범위", () => {
  it("team-scope만 가진 사용자: getPermissionSummary는 키 노출(메뉴 보임)", async () => {
    const summary = await getPermissionSummary("u1");
    expect(summary.keys).toContain("leave.approval:view");
  });
  it("team-scope만 가진 사용자: hasPermission/requirePermission은 거부 유지(전역 상승 차단)", async () => {
    expect(await hasPermission("u1", "leave.approval", "view")).toBe(false); // scope=all 아님
    await expect(requirePermission("u1", "leave.approval", "view")).rejects.toBeInstanceOf(ForbiddenError);
  });
  // F-A — 비-scopeable resource(admin.teams)에 team override가 걸려도 summary 키가 안 생긴다(서버 페이지 누수 차단).
  it("비-scopeable resource의 team override는 summary 키를 만들지 않는다(F-A: page-layer 누수 차단)", async () => {
    h.db.permission.findMany.mockResolvedValue([{ id: "p2", resource: "admin.teams", action: "view" }]);
    h.db.rolePermission.findMany.mockResolvedValue([]);
    h.db.userPermissionOverride.findMany.mockResolvedValue([{ permissionId: "p2", effect: "ALLOW", scope: "team", startsAt: null, endsAt: null }]);
    const summary = await getPermissionSummary("u1");
    expect(summary.keys).not.toContain("admin.teams:view"); // clamp → null → 키 없음(페이지 redirect)
  });
  it("비-scopeable resource의 all override/role은 정상 노출(admin 권한 유지)", async () => {
    h.db.permission.findMany.mockResolvedValue([{ id: "p2", resource: "admin.teams", action: "view" }]);
    h.db.rolePermission.findMany.mockResolvedValue([{ permissionId: "p2", effect: "ALLOW", scope: "all" }]);
    h.db.userPermissionOverride.findMany.mockResolvedValue([]);
    const summary = await getPermissionSummary("u1");
    expect(summary.keys).toContain("admin.teams:view");
  });
});
