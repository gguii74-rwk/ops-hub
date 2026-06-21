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
  it("must-change OWNER도 빈 keys·isOwner=false(OWNER 우회 금지 — finding 3 actor 권위도 fail-closed)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: true, roleAssignments: [] });
    const summary = await getPermissionSummary("u1");
    expect(summary.keys).toEqual([]);
    expect(summary.isOwner).toBe(false); // must-change면 actor 권위도 비-OWNER 취급
  });
  it("ACTIVE·must-change=false OWNER는 isOwner=true (finding 3 — buildActorCtx가 이 값을 신뢰)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: false, roleAssignments: [] });
    expect((await getPermissionSummary("u1")).isOwner).toBe(true);
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
  it("비-ACTIVE는 기존대로 빈 summary·isOwner=false(회귀 보존)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "DISABLED", mustChangePassword: false, roleAssignments: [] });
    const summary = await getPermissionSummary("u1");
    expect(summary.keys).toEqual([]);
    expect(summary.isOwner).toBe(false); // 비활성 OWNER도 actor 권위 fail-closed
    expect(await hasPermission("u1", "admin.users", "view")).toBe(false);
  });
});
