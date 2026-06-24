import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    accessRole: { findUnique: vi.fn() },
    permission: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
const access = vi.hoisted(() => ({ requirePermission: vi.fn(), setCell: vi.fn() }));
vi.mock("@/kernel/access", async (orig) => ({ ...(await orig()), requirePermission: access.requirePermission }));
vi.mock("@/modules/admin/roles/repositories", async (orig) => ({ ...(await orig()), setCell: access.setCell }));

import { setRoleCellsBulk } from "@/modules/admin/roles/services";
import { ForbiddenError } from "@/kernel/access";

beforeEach(() => {
  vi.clearAllMocks();
  access.requirePermission.mockResolvedValue(undefined);
  access.setCell.mockResolvedValue(undefined);
  h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: false });
});

describe("setRoleCellsBulk", () => {
  it("ALLOW 전체: 매칭 권한 전부 적용(scope all)", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "regular-developer" });
    h.db.permission.findMany.mockResolvedValue([
      { id: "p1", resource: "calendar.work", action: "view" },
      { id: "p2", resource: "calendar.leave", action: "view" },
      { id: "p3", resource: "calendar.team", action: "view" },
    ]);
    const r = await setRoleCellsBulk("owner", "r1", "calendar", "ALLOW");
    expect(r).toEqual({ applied: 3, skipped: [] });
    expect(access.setCell).toHaveBeenCalledTimes(3);
    expect(access.setCell).toHaveBeenCalledWith("r1", "p1", "ALLOW", "all", "owner");
  });

  it("비특권 role × admin ALLOW: 전부 skip(권한 상승 차단), setCell 미호출", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "regular-developer" });
    h.db.permission.findMany.mockResolvedValue([
      { id: "p1", resource: "admin.users", action: "view" },
      { id: "p2", resource: "admin.users", action: "update" },
    ]);
    const r = await setRoleCellsBulk("owner", "r1", "admin", "ALLOW");
    expect(r.applied).toBe(0);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0].reason).toMatch(/비특권|상승/);
    expect(access.setCell).not.toHaveBeenCalled();
  });

  it("admin role × admin ALLOW: admin.roles:configure만 skip, 나머지 적용", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "admin" });
    h.db.permission.findMany.mockResolvedValue([
      { id: "p1", resource: "admin.users", action: "view" },
      { id: "p2", resource: "admin.roles", action: "configure" },
    ]);
    const r = await setRoleCellsBulk("owner", "r1", "admin", "ALLOW");
    expect(r.applied).toBe(1);
    expect(r.skipped).toEqual([{ key: "admin.roles:configure", reason: expect.stringMatching(/OWNER 전용/) }]);
    expect(access.setCell).toHaveBeenCalledTimes(1);
    expect(access.setCell).toHaveBeenCalledWith("r1", "p1", "ALLOW", "all", "owner");
  });

  it("DENY 전체: 비특권 role × admin도 전부 적용(제거는 상승 아님)", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "regular-developer" });
    h.db.permission.findMany.mockResolvedValue([
      { id: "p1", resource: "admin.users", action: "view" },
      { id: "p2", resource: "admin.roles", action: "configure" },
    ]);
    const r = await setRoleCellsBulk("owner", "r1", "admin", "DENY");
    expect(r.applied).toBe(2);
    expect(access.setCell).toHaveBeenCalledWith("r1", "p1", "DENY", "all", "owner");
    expect(access.setCell).toHaveBeenCalledWith("r1", "p2", "DENY", "all", "owner");
  });

  it("해제 전체(none): 매칭 권한 전부 제거", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "admin" });
    h.db.permission.findMany.mockResolvedValue([
      { id: "p1", resource: "admin.users", action: "view" },
    ]);
    const r = await setRoleCellsBulk("owner", "r1", "admin", "none");
    expect(r.applied).toBe(1);
    expect(access.setCell).toHaveBeenCalledWith("r1", "p1", "none", "all", "owner");
  });

  it("pm 역할은 거부(setCell 미호출)", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "pm" });
    await expect(setRoleCellsBulk("owner", "rpm", "admin", "ALLOW")).rejects.toThrow(/pm/);
    expect(access.setCell).not.toHaveBeenCalled();
  });

  it("비-OWNER actor는 거부(fail-closed, D8)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "ADMIN", status: "ACTIVE", mustChangePassword: false });
    h.db.accessRole.findUnique.mockResolvedValue({ key: "admin" });
    await expect(setRoleCellsBulk("u1", "r1", "admin", "ALLOW")).rejects.toBeInstanceOf(ForbiddenError);
    expect(access.setCell).not.toHaveBeenCalled();
  });
});
