import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const db = {
    user: { findUnique: vi.fn() },
    permission: { findUnique: vi.fn(), findMany: vi.fn() },
    userPermissionOverride: { findMany: vi.fn() },
    rolePermission: { findMany: vi.fn() },
  };
  return { db };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { getPermissionSummary, hasPermission, requirePermission, ForbiddenError } from "@/kernel/access";

beforeEach(() => {
  vi.clearAllMocks();
  h.db.permission.findMany.mockResolvedValue([{ id: "p1", resource: "admin.users", action: "view" }]);
  h.db.permission.findUnique.mockResolvedValue({ id: "p1" });
  h.db.userPermissionOverride.findMany.mockResolvedValue([]);
  h.db.rolePermission.findMany.mockResolvedValue([{ permissionId: "p1", effect: "ALLOW", scope: "all" }]);
});

describe("mustChangePassword 중앙 게이트(D17)", () => {
  it("must-change 사용자는 getPermissionSummary가 빈 keys(fail-closed)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "MEMBER", status: "ACTIVE", mustChangePassword: true, roleAssignments: [{ roleId: "r1", startsAt: null, endsAt: null }] });
    const summary = await getPermissionSummary("u1");
    expect(summary.keys).toEqual([]);
  });
  it("must-change OWNER도 빈 keys·isOwner/isAdmin=false(OWNER 우회 금지 — finding 3 actor 권위도 fail-closed)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: true, roleAssignments: [] });
    const summary = await getPermissionSummary("u1");
    expect(summary.keys).toEqual([]);
    expect(summary.isOwner).toBe(false); // must-change면 actor 권위도 비-OWNER 취급
    expect(summary.isAdmin).toBe(false); // coarse admin 권위도 fail-closed
  });
  it("must-change ADMIN도 isAdmin=false(coarse admin 우회 금지 — workflow resolve 등)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "ADMIN", status: "ACTIVE", mustChangePassword: true, roleAssignments: [] });
    expect((await getPermissionSummary("u1")).isAdmin).toBe(false);
  });
  it("ACTIVE·must-change=false OWNER는 isOwner=true·isAdmin=true (권위 단일 출처 — buildActorCtx/buildMailCtx가 이 값을 신뢰)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: false, roleAssignments: [] });
    const summary = await getPermissionSummary("u1");
    expect(summary.isOwner).toBe(true);
    expect(summary.isAdmin).toBe(true);
  });
  it("ACTIVE·must-change=false ADMIN(비-OWNER)는 isOwner=false·isAdmin=true (coarse admin)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "ADMIN", status: "ACTIVE", mustChangePassword: false, roleAssignments: [] });
    const summary = await getPermissionSummary("u1");
    expect(summary.isOwner).toBe(false);
    expect(summary.isAdmin).toBe(true);
  });
  it("must-change면 hasPermission false·requirePermission ForbiddenError", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: true, roleAssignments: [] });
    expect(await hasPermission("u1", "admin.users", "view")).toBe(false);
    await expect(requirePermission("u1", "admin.users", "view")).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("must-change=false면 정상 평가(역할 ALLOW 인정)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "MEMBER", status: "ACTIVE", mustChangePassword: false, roleAssignments: [{ roleId: "r1", startsAt: null, endsAt: null }] });
    expect(await hasPermission("u1", "admin.users", "view")).toBe(true);
    const summary = await getPermissionSummary("u1");
    expect(summary.keys).toContain("admin.users:view");
  });
  it("비-ACTIVE는 기존대로 빈 summary·isOwner/isAdmin=false(회귀 보존)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "DISABLED", mustChangePassword: false, roleAssignments: [] });
    const summary = await getPermissionSummary("u1");
    expect(summary.keys).toEqual([]);
    expect(summary.isOwner).toBe(false); // 비활성 OWNER도 actor 권위 fail-closed
    expect(summary.isAdmin).toBe(false); // 비활성이면 coarse admin도 false
    expect(await hasPermission("u1", "admin.users", "view")).toBe(false);
  });
});
