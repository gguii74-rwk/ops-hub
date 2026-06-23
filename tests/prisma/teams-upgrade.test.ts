import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyTeamsPermissionUpgrade, UPGRADE_GRANT_KEYS } from "../../prisma/migrate-helpers/teams-upgrade";

function mkDb(flagExists: boolean) {
  return {
    systemSetting: { findUnique: vi.fn(async () => (flagExists ? { key: "x" } : null)), create: vi.fn(async () => ({})) },
    rolePermission: { upsert: vi.fn(async () => ({})) },
  };
}
const roleIds = new Map([["admin", "role-admin"]]);
const permIds = new Map(UPGRADE_GRANT_KEYS.map((k, i) => [k, `perm-${i}`]));

describe("applyTeamsPermissionUpgrade (D10/F4)", () => {
  it("플래그 없으면 3개 grant upsert + 플래그 set(비어있지 않은 기존 설치)", async () => {
    const db = mkDb(false);
    const r = await applyTeamsPermissionUpgrade(db as never, roleIds, permIds);
    expect(r.applied).toBe(true);
    expect(db.rolePermission.upsert).toHaveBeenCalledTimes(3);
    expect(db.systemSetting.create).toHaveBeenCalled();
  });
  it("플래그 있으면 no-op(1회 보장 — OWNER 편집 보존)", async () => {
    const db = mkDb(true);
    const r = await applyTeamsPermissionUpgrade(db as never, roleIds, permIds);
    expect(r.applied).toBe(false);
    expect(db.rolePermission.upsert).not.toHaveBeenCalled();
  });
  it("필수 권한 누락 시 throw + 플래그 미설정(fail-closed, F-K)", async () => {
    const db = mkDb(false);
    const partialPerms = new Map([[UPGRADE_GRANT_KEYS[0], "perm-0"]]); // 1개만 존재 — 나머지 누락
    await expect(applyTeamsPermissionUpgrade(db as never, roleIds, partialPerms)).rejects.toThrow(/미존재/);
    expect(db.systemSetting.create).not.toHaveBeenCalled(); // 플래그 set 안 됨 → 다음 seed 재시도
  });
  it("admin 역할 누락 시 throw + 플래그 미설정", async () => {
    const db = mkDb(false);
    await expect(applyTeamsPermissionUpgrade(db as never, new Map(), permIds)).rejects.toThrow(/admin/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });
});
