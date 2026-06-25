import type { UpgradeClient } from "./teams-upgrade"; // 동일한 최소 client 표면 재사용

export const LEAVE_NOTIF_UPGRADE_FLAG = "migration.leave-notifications.upgrade.applied";
export const LEAVE_NOTIF_GRANT_KEYS = ["leave.admin:configure"] as const;
// D6 신뢰경계: pm만. 위임 admin은 leave 권한 0 유지. OWNER는 systemRole 자동(행 불필요).
// fresh install은 pm:"*"로 grant하므로 upgrade도 pm만 reconcile → fresh/existing 패리티.
export const LEAVE_NOTIF_TARGET_ROLE_KEYS = ["pm"] as const;

// pm에 leave.admin:configure 멱등 grant. 이미 적용(플래그 존재)이면 no-op.
// F-K fail-closed: 대상 역할·권한 중 하나라도 없으면 throw(플래그 미설정) → 다음 seed 재시도.
// 플래그는 모든 upsert 성공 후에만 set.
export async function applyLeaveNotificationsPermissionUpgrade(
  db: UpgradeClient,
  roleIdByKey: Map<string, string>,
  permissionIdByKey: Map<string, string>,
): Promise<{ applied: boolean }> {
  const already = await db.systemSetting.findUnique({ where: { key: LEAVE_NOTIF_UPGRADE_FLAG } });
  if (already) return { applied: false };
  const roleIds = LEAVE_NOTIF_TARGET_ROLE_KEYS.map((key) => {
    const id = roleIdByKey.get(key);
    if (!id) throw new Error(`leave-notifications-upgrade: '${key}' 역할 미존재(seed 순서/드리프트) — 플래그 미설정, 재시도`);
    return id;
  });
  const grants = LEAVE_NOTIF_GRANT_KEYS.map((key) => {
    const pid = permissionIdByKey.get(key);
    if (!pid) throw new Error(`leave-notifications-upgrade: 권한 '${key}' 미존재 — 플래그 미설정, 재시도`);
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
  await db.systemSetting.create({ data: { key: LEAVE_NOTIF_UPGRADE_FLAG, value: { appliedAt: "bootstrap" } } });
  return { applied: true };
}
