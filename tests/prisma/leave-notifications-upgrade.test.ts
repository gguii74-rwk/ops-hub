import { describe, it, expect, vi } from "vitest";
import {
  applyLeaveNotificationsPermissionUpgrade,
  LEAVE_NOTIF_GRANT_KEYS,
} from "../../prisma/migrate-helpers/leave-notifications-upgrade";

type UpsertArg = { where: { roleId_permissionId_scope: { roleId: string; permissionId: string; scope: string } } };
function mkDb(flagExists: boolean) {
  return {
    systemSetting: { findUnique: vi.fn(async () => (flagExists ? { key: "x" } : null)), create: vi.fn(async () => ({})) },
    rolePermission: { upsert: vi.fn(async (_a: UpsertArg) => ({})) },
  };
}
const roleIds = new Map([["pm", "role-pm"], ["admin", "role-admin"]]);
const permIds = new Map(LEAVE_NOTIF_GRANT_KEYS.map((k, i) => [k, `perm-${i}`]));

describe("applyLeaveNotificationsPermissionUpgrade (D6/R4)", () => {
  it("플래그 없으면 pm에 leave.admin:configure grant upsert(=1) + 플래그 set(기존 비어있지 않은 DB)", async () => {
    const db = mkDb(false);
    const r = await applyLeaveNotificationsPermissionUpgrade(db as never, roleIds, permIds);
    expect(r.applied).toBe(true);
    expect(db.rolePermission.upsert).toHaveBeenCalledTimes(1); // pm × 1키
    expect(db.systemSetting.create).toHaveBeenCalled();
  });

  it("D6 경계: 위임 admin 역할에는 grant하지 않는다(pm만)", async () => {
    const db = mkDb(false);
    await applyLeaveNotificationsPermissionUpgrade(db as never, roleIds, permIds);
    const upsertedRoleIds = db.rolePermission.upsert.mock.calls.map((c) => c[0].where.roleId_permissionId_scope.roleId);
    expect(upsertedRoleIds).toContain("role-pm");
    expect(upsertedRoleIds).not.toContain("role-admin"); // 위임 user-admin 제외(신뢰경계)
  });

  it("플래그 있으면 no-op(1회 보장 — OWNER/수동 편집 보존)", async () => {
    const db = mkDb(true);
    const r = await applyLeaveNotificationsPermissionUpgrade(db as never, roleIds, permIds);
    expect(r.applied).toBe(false);
    expect(db.rolePermission.upsert).not.toHaveBeenCalled();
  });

  it("권한 미존재 시 throw + 플래그 미설정(fail-closed)", async () => {
    const db = mkDb(false);
    await expect(applyLeaveNotificationsPermissionUpgrade(db as never, roleIds, new Map())).rejects.toThrow(/미존재/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });

  it("pm 역할 미존재 시 throw + 플래그 미설정", async () => {
    const db = mkDb(false);
    await expect(applyLeaveNotificationsPermissionUpgrade(db as never, new Map(), permIds)).rejects.toThrow(/pm/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });
});
