import { describe, it, expect, vi } from "vitest";
import {
  applyWorkflowsClientKindsUpgrade,
  CLIENT_VIEW_DRIVER_KEY,
  CLIENT_VIEW_KEYS,
  CLIENT_CREATE_KEYS,
} from "../../prisma/migrate-helpers/workflows-client-kinds-upgrade";

function permMap() {
  const m = new Map<string, string>();
  m.set(CLIENT_VIEW_DRIVER_KEY, "perm-weekly-view");
  CLIENT_VIEW_KEYS.forEach((k, i) => m.set(k, `perm-view-${i}`));
  CLIENT_CREATE_KEYS.forEach((k, i) => m.set(k, `perm-create-${i}`));
  return m;
}
function roleMap(withPm = true) {
  const m = new Map<string, string>();
  if (withPm) m.set("pm", "role-pm");
  return m;
}
type WeeklyViewRow = { roleId: string; effect: "ALLOW" | "DENY"; scope: string };
const allow = (roleId: string, scope = "all"): WeeklyViewRow => ({ roleId, effect: "ALLOW", scope });
const deny = (roleId: string, scope = "all"): WeeklyViewRow => ({ roleId, effect: "DENY", scope });

function mkDb(flagExists: boolean, viewHolderRows: WeeklyViewRow[]) {
  return {
    systemSetting: { findUnique: vi.fn(async () => (flagExists ? { key: "x" } : null)), create: vi.fn(async () => ({})) },
    rolePermission: {
      findMany: vi.fn(async () => viewHolderRows),
      upsert: vi.fn(async () => ({})),
    },
  };
}

describe("applyWorkflowsClientKindsUpgrade (R3·F1 — 기존 DB client kind reconcile)", () => {
  it("weekly:view 보유 role에 client :view 2종, pm에 client :create 2종 grant + 플래그", async () => {
    const db = mkDb(false, [allow("r1"), allow("r1"), allow("r2")]);
    const r = await applyWorkflowsClientKindsUpgrade(db as never, roleMap(), permMap());
    expect(r.applied).toBe(true);
    expect(r.grantedViewRoleCount).toBe(2);
    expect(r.grantedCreateRoleCount).toBe(1);

    // view 조회는 weekly:view 권한 기준.
    expect((db.rolePermission.findMany.mock.calls[0] as any)[0].where.permissionId).toBe("perm-weekly-view");

    const calls = db.rolePermission.upsert.mock.calls.map((c: any) => c[0]);
    // r1·r2에 client view 2종씩(4) + pm에 client create 2종(2) = 6.
    expect(calls.length).toBe(6);
    const viewGrants = calls.filter((c) => ["perm-view-0", "perm-view-1"].includes(c.create.permissionId));
    const createGrants = calls.filter((c) => ["perm-create-0", "perm-create-1"].includes(c.create.permissionId));
    expect(new Set(viewGrants.map((c) => c.create.roleId))).toEqual(new Set(["r1", "r2"]));
    expect(new Set(createGrants.map((c) => c.create.roleId))).toEqual(new Set(["role-pm"]));
    expect(db.systemSetting.create).toHaveBeenCalled();
  });

  it("drift 행(scope=team/own, ALLOW+DENY 혼재)은 client view 제외 — effective 규칙(R4·F1)", async () => {
    // rAll=유효(scope=all ALLOW), rTeam/rOwn=non-scopeable에서 비유효, rDenied=DENY 우선.
    const db = mkDb(false, [allow("rAll"), allow("rTeam", "team"), allow("rOwn", "own"), allow("rDenied"), deny("rDenied")]);
    const r = await applyWorkflowsClientKindsUpgrade(db as never, roleMap(), permMap());
    expect(r.grantedViewRoleCount).toBe(1); // rAll만
    const calls = db.rolePermission.upsert.mock.calls.map((c: any) => c[0]);
    const viewGrants = calls.filter((c) => ["perm-view-0", "perm-view-1"].includes(c.create.permissionId));
    expect(new Set(viewGrants.map((c) => c.create.roleId))).toEqual(new Set(["rAll"]));
  });

  it("weekly:view 보유 role 없어도 pm에 client :create는 부여", async () => {
    const db = mkDb(false, []);
    const r = await applyWorkflowsClientKindsUpgrade(db as never, roleMap(), permMap());
    expect(r.grantedViewRoleCount).toBe(0);
    expect(r.grantedCreateRoleCount).toBe(1);
    const calls = db.rolePermission.upsert.mock.calls.map((c: any) => c[0]);
    expect(calls.length).toBe(2); // pm client create 2종만
    expect(db.systemSetting.create).toHaveBeenCalled();
  });

  it("플래그 있으면 no-op(조회 안 함)", async () => {
    const db = mkDb(true, [allow("r1")]);
    const r = await applyWorkflowsClientKindsUpgrade(db as never, roleMap(), permMap());
    expect(r.applied).toBe(false);
    expect(db.rolePermission.findMany).not.toHaveBeenCalled();
    expect(db.rolePermission.upsert).not.toHaveBeenCalled();
  });

  it("client 권한 미존재 → throw + 플래그 미설정", async () => {
    const db = mkDb(false, [allow("r1")]);
    const m = permMap(); m.delete(CLIENT_CREATE_KEYS[0]);
    await expect(applyWorkflowsClientKindsUpgrade(db as never, roleMap(), m)).rejects.toThrow(/미존재/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });

  it("pm 역할 미존재 → throw + 플래그 미설정", async () => {
    const db = mkDb(false, [allow("r1")]);
    await expect(applyWorkflowsClientKindsUpgrade(db as never, roleMap(false), permMap())).rejects.toThrow(/역할 미존재/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });
});
