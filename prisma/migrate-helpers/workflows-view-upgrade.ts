// 신규 집계 workflows:view(D13)는 nav 게이팅 전용. fresh install은 ROLE_ALLOW로 grant하지만, bootstrap을 건너뛰는
// 기존 DB(RolePermission count>0)는 grant를 못 받아 nav flip 시 메뉴를 잃는다. 이 헬퍼가 임의 workflows.<kind>:view 보유
// 대상에 workflows:view를 1회 멱등 reconcile한다(dynamic — 고정 role 아님. CMS 커스텀 role도 커버).
// 유효권한은 role뿐 아니라 UserPermissionOverride도 포함하므로(getPermissionSummary), kind-view를 override로만 가진
// 사용자도 함께 승격해야 nav flip 후 메뉴를 잃지 않는다(접근제어 규칙①: nav=API 접근권 일치). workflows.*는 non-scopeable이라
// scope="all" ALLOW override만 메뉴 키를 만든다 → 그 조건의 override 보유 사용자에게 집계 override를 부여.
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
  userPermissionOverride: {
    findMany(a: { where: { permissionId: { in: string[] }; effect: "ALLOW"; scope: string }; select: { userId: true } }): Promise<Array<{ userId: string }>>;
    upsert(a: {
      where: { userId_permissionId_scope: { userId: string; permissionId: string; scope: string } };
      update: Record<string, never>;
      create: { userId: string; permissionId: string; effect: "ALLOW"; scope: string };
    }): Promise<unknown>;
  };
}

export const WORKFLOWS_VIEW_UPGRADE_FLAG = "migration.workflows-view.upgrade.applied";
export const WORKFLOWS_VIEW_KEY = "workflows:view";

// permissionIdByKey: seed가 채운 맵. kindViewKeys: workflows.<kind>:view 키 배열(seed가 KIND_RESOURCE에서 파생).
// fail-closed: 집계/kind view 권한 중 하나라도 없으면 throw(플래그 미설정 → 다음 seed 재시도). 플래그는 role+user upsert 모두 성공 후에만.
export async function applyWorkflowsViewUpgrade(
  db: WorkflowsViewUpgradeClient,
  permissionIdByKey: Map<string, string>,
  kindViewKeys: string[],
): Promise<{ applied: boolean; grantedRoleCount: number; grantedUserCount: number }> {
  const already = await db.systemSetting.findUnique({ where: { key: WORKFLOWS_VIEW_UPGRADE_FLAG } });
  if (already) return { applied: false, grantedRoleCount: 0, grantedUserCount: 0 };
  const aggId = permissionIdByKey.get(WORKFLOWS_VIEW_KEY);
  if (!aggId) throw new Error(`workflows-view-upgrade: 권한 '${WORKFLOWS_VIEW_KEY}' 미존재 — 플래그 미설정, 재시도`);
  const kindViewIds = kindViewKeys.map((k) => {
    const id = permissionIdByKey.get(k);
    if (!id) throw new Error(`workflows-view-upgrade: 권한 '${k}' 미존재 — 플래그 미설정, 재시도`);
    return id;
  });

  // (a) role 경로: 임의 kind-view ALLOW 보유 role에 집계 grant.
  const roleRows = await db.rolePermission.findMany({
    where: { permissionId: { in: kindViewIds }, effect: "ALLOW" },
    select: { roleId: true },
  });
  const roleIds = [...new Set(roleRows.map((r) => r.roleId))];
  for (const roleId of roleIds) {
    await db.rolePermission.upsert({
      where: { roleId_permissionId_scope: { roleId, permissionId: aggId, scope: "all" } },
      update: {},
      create: { roleId, permissionId: aggId, effect: "ALLOW", scope: "all" },
    });
  }

  // (b) override 경로: kind-view를 scope="all" ALLOW override로만 가진 사용자에게도 집계 override(R2·F1).
  const userRows = await db.userPermissionOverride.findMany({
    where: { permissionId: { in: kindViewIds }, effect: "ALLOW", scope: "all" },
    select: { userId: true },
  });
  const userIds = [...new Set(userRows.map((u) => u.userId))];
  for (const userId of userIds) {
    await db.userPermissionOverride.upsert({
      where: { userId_permissionId_scope: { userId, permissionId: aggId, scope: "all" } },
      update: {},
      create: { userId, permissionId: aggId, effect: "ALLOW", scope: "all" },
    });
  }

  await db.systemSetting.create({
    data: { key: WORKFLOWS_VIEW_UPGRADE_FLAG, value: { appliedAt: "bootstrap", roleCount: roleIds.length, userCount: userIds.length } },
  });
  return { applied: true, grantedRoleCount: roleIds.length, grantedUserCount: userIds.length };
}
