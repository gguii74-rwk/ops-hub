import { describe, it, expect, vi } from "vitest";
import { applyWorkflowsViewUpgrade, WORKFLOWS_VIEW_KEY } from "../../prisma/migrate-helpers/workflows-view-upgrade";

const KIND_VIEW_KEYS = ["workflows.weekly:view", "workflows.notification:view", "workflows.billing:view", "workflows.weeklyClient:view", "workflows.monthlyClient:view"];
function permMap() {
  const m = new Map<string, string>();
  m.set(WORKFLOWS_VIEW_KEY, "perm-agg");
  KIND_VIEW_KEYS.forEach((k, i) => m.set(k, `perm-${i}`));
  return m;
}
function mkDb(
  flagExists: boolean,
  roleRows: Array<{ roleId: string }>,
  userRows: Array<{ userId: string }> = [],
) {
  return {
    systemSetting: { findUnique: vi.fn(async () => (flagExists ? { key: "x" } : null)), create: vi.fn(async () => ({})) },
    rolePermission: {
      findMany: vi.fn(async () => roleRows),
      upsert: vi.fn(async () => ({})),
    },
    userPermissionOverride: {
      findMany: vi.fn(async () => userRows),
      upsert: vi.fn(async () => ({})),
    },
  };
}

describe("applyWorkflowsViewUpgrade (D13 — 기존 role+override reconcile)", () => {
  it("임의 kind view 보유 role(중복 제거)에 workflows:view grant + 플래그", async () => {
    const db = mkDb(false, [{ roleId: "r1" }, { roleId: "r1" }, { roleId: "r2" }]);
    const r = await applyWorkflowsViewUpgrade(db as never, permMap(), KIND_VIEW_KEYS);
    expect(r.applied).toBe(true);
    expect(r.grantedRoleCount).toBe(2);
    const ids = db.rolePermission.upsert.mock.calls.map((c: any) => c[0].where.roleId_permissionId_scope.roleId);
    expect(new Set(ids)).toEqual(new Set(["r1", "r2"]));
    for (const c of db.rolePermission.upsert.mock.calls as any[]) {
      expect((c[0] as any).create.permissionId).toBe("perm-agg");
    }
    expect(db.systemSetting.create).toHaveBeenCalled();
  });

  it("kind view를 scope=all ALLOW override로만 가진 사용자(중복 제거)도 집계 override로 승격 (R2·F1)", async () => {
    const db = mkDb(false, [], [{ userId: "u1" }, { userId: "u1" }, { userId: "u2" }]);
    const r = await applyWorkflowsViewUpgrade(db as never, permMap(), KIND_VIEW_KEYS);
    expect(r.applied).toBe(true);
    expect(r.grantedUserCount).toBe(2);
    // override 조회는 scope="all" ALLOW로 한정(non-scopeable workflows.*는 이것만 메뉴 키를 만듦).
    const where = (db.userPermissionOverride.findMany.mock.calls[0] as any)[0].where;
    expect(where.effect).toBe("ALLOW");
    expect(where.scope).toBe("all");
    const ids = db.userPermissionOverride.upsert.mock.calls.map((c: any) => c[0].where.userId_permissionId_scope.userId);
    expect(new Set(ids)).toEqual(new Set(["u1", "u2"]));
    for (const c of db.userPermissionOverride.upsert.mock.calls as any[]) {
      expect((c[0] as any).create.permissionId).toBe("perm-agg");
      expect((c[0] as any).create.effect).toBe("ALLOW");
      expect((c[0] as any).create.scope).toBe("all");
    }
    expect(db.systemSetting.create).toHaveBeenCalled();
  });

  it("role·override 둘 다 있으면 각각 승격", async () => {
    const db = mkDb(false, [{ roleId: "r1" }], [{ userId: "u1" }]);
    const r = await applyWorkflowsViewUpgrade(db as never, permMap(), KIND_VIEW_KEYS);
    expect(r.grantedRoleCount).toBe(1);
    expect(r.grantedUserCount).toBe(1);
    expect(db.rolePermission.upsert).toHaveBeenCalledTimes(1);
    expect(db.userPermissionOverride.upsert).toHaveBeenCalledTimes(1);
  });

  it("대상 role·override 없으면 grant 0 + 플래그 set(멱등)", async () => {
    const db = mkDb(false, [], []);
    const r = await applyWorkflowsViewUpgrade(db as never, permMap(), KIND_VIEW_KEYS);
    expect(r.applied).toBe(true);
    expect(db.rolePermission.upsert).not.toHaveBeenCalled();
    expect(db.userPermissionOverride.upsert).not.toHaveBeenCalled();
    expect(db.systemSetting.create).toHaveBeenCalled();
  });

  it("플래그 있으면 no-op(role·override 조회 안 함)", async () => {
    const db = mkDb(true, [{ roleId: "r1" }], [{ userId: "u1" }]);
    const r = await applyWorkflowsViewUpgrade(db as never, permMap(), KIND_VIEW_KEYS);
    expect(r.applied).toBe(false);
    expect(db.rolePermission.findMany).not.toHaveBeenCalled();
    expect(db.userPermissionOverride.findMany).not.toHaveBeenCalled();
  });

  it("workflows:view 권한 미존재 → throw + 플래그 미설정", async () => {
    const db = mkDb(false, [], []);
    const m = permMap(); m.delete(WORKFLOWS_VIEW_KEY);
    await expect(applyWorkflowsViewUpgrade(db as never, m, KIND_VIEW_KEYS)).rejects.toThrow(/workflows:view/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });
});
