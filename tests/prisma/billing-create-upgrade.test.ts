import { describe, it, expect, vi } from "vitest";
import {
  applyBillingCreatePermissionUpgrade,
  BILLING_CREATE_GRANT_KEYS,
} from "../../prisma/migrate-helpers/billing-create-upgrade";

type UpsertArg = { where: { roleId_permissionId_scope: { roleId: string; permissionId: string; scope: string } } };
function mkDb(flagExists: boolean) {
  return {
    systemSetting: { findUnique: vi.fn(async () => (flagExists ? { key: "x" } : null)), create: vi.fn(async () => ({})) },
    rolePermission: { upsert: vi.fn(async (_a: UpsertArg) => ({})) },
  };
}
const roleIds = new Map([["pm", "role-pm"], ["admin", "role-admin"]]);
const permIds = new Map(BILLING_CREATE_GRANT_KEYS.map((k, i) => [k, `perm-${i}`]));

describe("applyBillingCreatePermissionUpgrade (N6 — 기존 DB create reconcile)", () => {
  it("플래그 없으면 pm에 billing:create grant(=1) + 플래그 set", async () => {
    const db = mkDb(false);
    const r = await applyBillingCreatePermissionUpgrade(db as never, roleIds, permIds);
    expect(r.applied).toBe(true);
    expect(db.rolePermission.upsert).toHaveBeenCalledTimes(1);
    expect(db.systemSetting.create).toHaveBeenCalled();
  });
  it("pm만 grant(위임 admin 제외 — billing-upgrade와 동일 신뢰경계)", async () => {
    const db = mkDb(false);
    await applyBillingCreatePermissionUpgrade(db as never, roleIds, permIds);
    const ids = db.rolePermission.upsert.mock.calls.map((c) => c[0].where.roleId_permissionId_scope.roleId);
    expect(ids).toContain("role-pm");
    expect(ids).not.toContain("role-admin");
  });
  it("별도 플래그 있으면 no-op(1회 보장)", async () => {
    const db = mkDb(true);
    const r = await applyBillingCreatePermissionUpgrade(db as never, roleIds, permIds);
    expect(r.applied).toBe(false);
    expect(db.rolePermission.upsert).not.toHaveBeenCalled();
  });
  it("권한 미존재 → throw + 플래그 미설정(fail-closed)", async () => {
    const db = mkDb(false);
    await expect(applyBillingCreatePermissionUpgrade(db as never, roleIds, new Map())).rejects.toThrow(/미존재/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });
  it("pm 역할 미존재 → throw + 플래그 미설정", async () => {
    const db = mkDb(false);
    await expect(applyBillingCreatePermissionUpgrade(db as never, new Map(), permIds)).rejects.toThrow(/pm/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });
});
