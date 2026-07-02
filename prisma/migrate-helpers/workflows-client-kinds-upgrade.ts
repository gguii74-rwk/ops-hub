// 신규 client kind 2종(주간보고 고객사·월간보고 고객사)의 role 권한은 ROLE_ALLOW에 추가됐지만, bootstrapRolePermissions는
// RolePermission이 하나라도 있으면 스킵되므로 기존 DB(dev/cutover 대상)엔 부여되지 않는다. workflows:view upgrade는 nav 집계만
// reconcile하고 client kind의 view/create는 다루지 않아, 기존 설치에선 client task가 OWNER 외엔 보이지도 예약되지도 않는다
// (fresh install과 divergence, R3·F1). billing-create-upgrade 선례와 동일하게 별도 멱등 플래그로 1회 reconcile한다.
//
// 미러링 규칙(fresh ROLE_ALLOW와 동일 결과):
//  - client :view → workflows.weekly:view 보유 role에 부여(regular/contractor dev·content·pm; civil-response는 weekly:view 없어 제외).
//    동적 규칙이 seed 4역할을 정확히 재현하고 CMS 커스텀 weekly-viewer·drift까지 커버.
//  - client :create → pm에만 부여(ROLE_ALLOW pm:"*"의 기존DB reconcile, 수준 B. OWNER는 systemRole 자동).
export interface WorkflowsClientKindsUpgradeClient {
  systemSetting: {
    findUnique(a: { where: { key: string } }): Promise<{ key: string } | null>;
    create(a: { data: { key: string; value: unknown } }): Promise<unknown>;
  };
  rolePermission: {
    findMany(a: { where: { permissionId: string }; select: { roleId: true; effect: true; scope: true } }): Promise<Array<{ roleId: string; effect: "ALLOW" | "DENY"; scope: string }>>;
    upsert(a: {
      where: { roleId_permissionId_scope: { roleId: string; permissionId: string; scope: string } };
      update: Record<string, never>;
      create: { roleId: string; permissionId: string; effect: "ALLOW"; scope: string };
    }): Promise<unknown>;
  };
}

export const WORKFLOWS_CLIENT_KINDS_UPGRADE_FLAG = "migration.workflows-client-kinds.upgrade.applied";
export const CLIENT_VIEW_KEYS = ["workflows.weeklyClient:view", "workflows.monthlyClient:view"] as const;
export const CLIENT_CREATE_KEYS = ["workflows.weeklyClient:create", "workflows.monthlyClient:create"] as const;
// view 부여 대상 = 이 권한 보유 role(ROLE_ALLOW상 client view를 받은 역할과 일치).
export const CLIENT_VIEW_DRIVER_KEY = "workflows.weekly:view";
// create 부여 대상 role(고정) — 수준 B: client 예약은 pm(+OWNER).
export const CLIENT_CREATE_TARGET_ROLE_KEYS = ["pm"] as const;

// fail-closed: 대상 role·권한 중 하나라도 없으면 throw(플래그 미설정 → 다음 seed 재시도). 플래그는 view+create upsert 모두 성공 후에만.
export async function applyWorkflowsClientKindsUpgrade(
  db: WorkflowsClientKindsUpgradeClient,
  roleIdByKey: Map<string, string>,
  permissionIdByKey: Map<string, string>,
): Promise<{ applied: boolean; grantedViewRoleCount: number; grantedCreateRoleCount: number }> {
  const already = await db.systemSetting.findUnique({ where: { key: WORKFLOWS_CLIENT_KINDS_UPGRADE_FLAG } });
  if (already) return { applied: false, grantedViewRoleCount: 0, grantedCreateRoleCount: 0 };

  const driverId = permissionIdByKey.get(CLIENT_VIEW_DRIVER_KEY);
  if (!driverId) throw new Error(`workflows-client-kinds-upgrade: 권한 '${CLIENT_VIEW_DRIVER_KEY}' 미존재 — 플래그 미설정, 재시도`);
  const resolve = (key: string) => {
    const id = permissionIdByKey.get(key);
    if (!id) throw new Error(`workflows-client-kinds-upgrade: 권한 '${key}' 미존재 — 플래그 미설정, 재시도`);
    return id;
  };
  const viewIds = CLIENT_VIEW_KEYS.map(resolve);
  const createIds = CLIENT_CREATE_KEYS.map(resolve);

  // (a) view: workflows.weekly:view를 **유효하게** 보유한 role에만 client :view 2종.
  // getPermissionSummary와 동일 규칙: workflows.*는 non-scopeable이라 scope="all" ALLOW만 유효하고, 같은 role에 DENY가
  // 있으면 role DENY가 우선(미유효). drift 행(scope=team/own, ALLOW+DENY 혼재)을 all-scope client 접근으로 과대승격하지 않는다(R4·F1).
  const viewRows = await db.rolePermission.findMany({
    where: { permissionId: driverId },
    select: { roleId: true, effect: true, scope: true },
  });
  const deniedRoleIds = new Set(viewRows.filter((r) => r.effect === "DENY").map((r) => r.roleId));
  const viewRoleIds = [
    ...new Set(
      viewRows
        .filter((r) => r.effect === "ALLOW" && r.scope === "all" && !deniedRoleIds.has(r.roleId))
        .map((r) => r.roleId),
    ),
  ];
  for (const roleId of viewRoleIds) {
    for (const pid of viewIds) {
      await db.rolePermission.upsert({
        where: { roleId_permissionId_scope: { roleId, permissionId: pid, scope: "all" } },
        update: {},
        create: { roleId, permissionId: pid, effect: "ALLOW", scope: "all" },
      });
    }
  }

  // (b) create: pm에 client :create 2종.
  const createRoleIds = CLIENT_CREATE_TARGET_ROLE_KEYS.map((key) => {
    const id = roleIdByKey.get(key);
    if (!id) throw new Error(`workflows-client-kinds-upgrade: '${key}' 역할 미존재(seed 순서/드리프트) — 플래그 미설정, 재시도`);
    return id;
  });
  for (const roleId of createRoleIds) {
    for (const pid of createIds) {
      await db.rolePermission.upsert({
        where: { roleId_permissionId_scope: { roleId, permissionId: pid, scope: "all" } },
        update: {},
        create: { roleId, permissionId: pid, effect: "ALLOW", scope: "all" },
      });
    }
  }

  await db.systemSetting.create({
    data: {
      key: WORKFLOWS_CLIENT_KINDS_UPGRADE_FLAG,
      value: { appliedAt: "bootstrap", viewRoleCount: viewRoleIds.length, createRoleCount: createRoleIds.length },
    },
  });
  return { applied: true, grantedViewRoleCount: viewRoleIds.length, grantedCreateRoleCount: createRoleIds.length };
}
