// 신규 집계 workflows:view(D13)는 nav 게이팅 전용. fresh install은 ROLE_ALLOW로 grant하지만, bootstrap을 건너뛰는
// 기존 DB(RolePermission count>0)는 grant를 못 받아 nav flip 시 메뉴를 잃는다. 이 헬퍼가 임의 workflows.<kind>:view 보유
// role에 workflows:view를 1회 멱등 reconcile한다(dynamic — 고정 role 아님. CMS 커스텀 role도 커버).
export interface WorkflowsViewUpgradeClient {
  systemSetting: {
    findUnique(a: { where: { key: string } }): Promise<{ key: string } | null>;
    create(a: { data: { key: string; value: unknown } }): Promise<unknown>;
  };
  rolePermission: {
    findMany(a: { where: { permissionId: { in: string[] }; effect: "ALLOW" }; select: { roleId: true } }): Promise<Array<{ roleId: string }>>;
    upsert(a: {
      where: { roleId_permissionId_scope: { roleId: string; permissionId: string; scope: string } };
      update: Record<string, never>;
      create: { roleId: string; permissionId: string; effect: "ALLOW"; scope: string };
    }): Promise<unknown>;
  };
}

export const WORKFLOWS_VIEW_UPGRADE_FLAG = "migration.workflows-view.upgrade.applied";
export const WORKFLOWS_VIEW_KEY = "workflows:view";

// permissionIdByKey: seed가 채운 맵. kindViewKeys: workflows.<kind>:view 키 배열(seed가 KIND_RESOURCE에서 파생).
// fail-closed: 집계/kind view 권한 중 하나라도 없으면 throw(플래그 미설정 → 다음 seed 재시도). 플래그는 모든 upsert 성공 후에만.
export async function applyWorkflowsViewUpgrade(
  db: WorkflowsViewUpgradeClient,
  permissionIdByKey: Map<string, string>,
  kindViewKeys: string[],
): Promise<{ applied: boolean; grantedRoleCount: number }> {
  const already = await db.systemSetting.findUnique({ where: { key: WORKFLOWS_VIEW_UPGRADE_FLAG } });
  if (already) return { applied: false, grantedRoleCount: 0 };
  const aggId = permissionIdByKey.get(WORKFLOWS_VIEW_KEY);
  if (!aggId) throw new Error(`workflows-view-upgrade: 권한 '${WORKFLOWS_VIEW_KEY}' 미존재 — 플래그 미설정, 재시도`);
  const kindViewIds = kindViewKeys.map((k) => {
    const id = permissionIdByKey.get(k);
    if (!id) throw new Error(`workflows-view-upgrade: 권한 '${k}' 미존재 — 플래그 미설정, 재시도`);
    return id;
  });
  const rows = await db.rolePermission.findMany({
    where: { permissionId: { in: kindViewIds }, effect: "ALLOW" },
    select: { roleId: true },
  });
  const roleIds = [...new Set(rows.map((r) => r.roleId))];
  for (const roleId of roleIds) {
    await db.rolePermission.upsert({
      where: { roleId_permissionId_scope: { roleId, permissionId: aggId, scope: "all" } },
      update: {},
      create: { roleId, permissionId: aggId, effect: "ALLOW", scope: "all" },
    });
  }
  await db.systemSetting.create({
    data: { key: WORKFLOWS_VIEW_UPGRADE_FLAG, value: { appliedAt: "bootstrap", roleCount: roleIds.length } },
  });
  return { applied: true, grantedRoleCount: roleIds.length };
}
