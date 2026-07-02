import type { UpgradeClient } from "./teams-upgrade"; // 동일한 최소 client 표면 재사용

// 메일 수신자 관리 신설 권한 workflows.mail:configure(D11). fresh install은 pm:"*"로 보유하지만
// bootstrapRolePermissions는 RolePermission이 하나라도 있으면 스킵되므로 기존 DB(dev/cutover 대상)의 pm에는
// 부여되지 않는다. billing-create-upgrade 선례와 동일하게 별도 멱등 플래그로 1회 reconcile한다.
export const WORKFLOWS_MAIL_CONFIGURE_UPGRADE_FLAG = "migration.workflows-mail-configure.upgrade.applied";
export const MAIL_CONFIGURE_GRANT_KEYS = ["workflows.mail:configure"] as const;
// D6 신뢰경계: pm만(OWNER는 systemRole 자동). 위임 admin은 workflows 권한 0 유지 —
// admin.settings:configure만으로는 교집합 게이트를 넘지 못한다(의도).
export const MAIL_CONFIGURE_TARGET_ROLE_KEYS = ["pm"] as const;

// pm에 workflows.mail:configure 멱등 grant. 이미 적용(플래그 존재)이면 no-op.
// fail-closed: 대상 역할·권한 중 하나라도 없으면 throw(플래그 미설정) → 다음 seed 재시도. 플래그는 모든 upsert 성공 후에만 set.
export async function applyWorkflowsMailConfigureUpgrade(
  db: UpgradeClient,
  roleIdByKey: Map<string, string>,
  permissionIdByKey: Map<string, string>,
): Promise<{ applied: boolean }> {
  const already = await db.systemSetting.findUnique({ where: { key: WORKFLOWS_MAIL_CONFIGURE_UPGRADE_FLAG } });
  if (already) return { applied: false };
  const roleIds = MAIL_CONFIGURE_TARGET_ROLE_KEYS.map((key) => {
    const id = roleIdByKey.get(key);
    if (!id) throw new Error(`workflows-mail-configure-upgrade: '${key}' 역할 미존재(seed 순서/드리프트) — 플래그 미설정, 재시도`);
    return id;
  });
  const grants = MAIL_CONFIGURE_GRANT_KEYS.map((key) => {
    const pid = permissionIdByKey.get(key);
    if (!pid) throw new Error(`workflows-mail-configure-upgrade: 권한 '${key}' 미존재 — 플래그 미설정, 재시도`);
    return pid;
  });
  for (const roleId of roleIds) {
    for (const pid of grants) {
      await db.rolePermission.upsert({
        where: { roleId_permissionId_scope: { roleId, permissionId: pid, scope: "all" } },
        update: {},
        create: { roleId, permissionId: pid, effect: "ALLOW", scope: "all" },
      });
    }
  }
  await db.systemSetting.create({ data: { key: WORKFLOWS_MAIL_CONFIGURE_UPGRADE_FLAG, value: { appliedAt: "bootstrap" } } });
  return { applied: true };
}
