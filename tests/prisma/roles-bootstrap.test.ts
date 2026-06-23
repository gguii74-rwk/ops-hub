import { describe, it, expect, vi } from "vitest";
import { bootstrapRolePermissions } from "../../prisma/migrate-helpers/roles-bootstrap";
import type { Cell } from "../../prisma/seed-roles";

type CreateManyArg = { data: Array<{ roleId: string; permissionId: string; effect: "ALLOW"; scope: string }>; skipDuplicates?: boolean };
function mkDb(existingCount: number) {
  return {
    rolePermission: {
      count: vi.fn(async () => existingCount),
      createMany: vi.fn(async (_a: CreateManyArg) => ({ count: 0 })),
    },
  };
}
const roles = [{ key: "admin" }, { key: "regular-developer" }];
const roleAllow: Record<string, Cell[]> = {
  admin: ["admin.users:view", "admin.roles:configure"], // OWNER 전용 키는 expandRoleCells가 제외(F-L)
  "regular-developer": ["dashboard:view"],
};
const roleIds = new Map([["admin", "role-admin"], ["regular-developer", "role-dev"]]);
const permIds = new Map([
  ["admin.users:view", "perm-users-view"],
  ["admin.roles:configure", "perm-roles-configure"],
  ["dashboard:view", "perm-dash-view"],
]);

describe("bootstrapRolePermissions (D9 / F-AA)", () => {
  it("RolePermission 행이 0개면 전 역할에 대해 createMany — 부트스트랩 시드", async () => {
    const db = mkDb(0);
    const r = await bootstrapRolePermissions(db as never, roles, roleAllow, roleIds, permIds);
    expect(r.seeded).toBe(true);
    expect(db.rolePermission.createMany).toHaveBeenCalledTimes(roles.length); // 역할 누락 없이 전부
  });

  it("이미 행이 있으면 no-op(기존 행/UI 편집 보존) — createMany 미호출", async () => {
    const db = mkDb(1);
    const r = await bootstrapRolePermissions(db as never, roles, roleAllow, roleIds, permIds);
    expect(r.seeded).toBe(false);
    expect(db.rolePermission.createMany).not.toHaveBeenCalled();
  });

  it("F-AA: count 검사를 createMany보다 먼저 수행(동일 tx 안에서 원자 단위로 묶임)", async () => {
    const db = mkDb(0);
    const order: string[] = [];
    db.rolePermission.count.mockImplementation(async () => { order.push("count"); return 0; });
    db.rolePermission.createMany.mockImplementation(async () => { order.push("createMany"); return { count: 0 }; });
    await bootstrapRolePermissions(db as never, roles, roleAllow, roleIds, permIds);
    expect(order[0]).toBe("count");
    expect(order.slice(1).every((s) => s === "createMany")).toBe(true);
  });

  it("OWNER 전용 키(admin.roles:configure)는 부트스트랩 grant에서 제외(F-L)", async () => {
    const db = mkDb(0);
    await bootstrapRolePermissions(db as never, [{ key: "admin" }], roleAllow, roleIds, permIds);
    const adminRows = db.rolePermission.createMany.mock.calls[0][0].data;
    expect(adminRows.map((r) => r.permissionId)).toContain("perm-users-view");
    expect(adminRows.map((r) => r.permissionId)).not.toContain("perm-roles-configure");
  });
});
