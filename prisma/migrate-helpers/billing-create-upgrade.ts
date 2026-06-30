import type { UpgradeClient } from "./teams-upgrade"; // 동일한 최소 client 표면 재사용

// 대금청구 UI 슬라이스가 작업 생성에 workflows.billing:create를 요구한다. fresh install은 pm:"*"로 이미 create를
// 보유하지만, billing-upgrade(configure/generate/send/view)만 적용된 기존 DB의 pm에는 create가 없다(별도 플래그라
// billing-upgrade 재실행으로는 reconcile 안 됨). 이 헬퍼가 별도 멱등 플래그로 create를 1회 reconcile한다.
export const BILLING_CREATE_UPGRADE_FLAG = "migration.billing.create.upgrade.applied";
export const BILLING_CREATE_GRANT_KEYS = ["workflows.billing:create"] as const;
// billing-upgrade와 동일 신뢰경계: pm만. 위임 admin은 workflows 권한 0 유지. OWNER는 systemRole 자동(행 불필요).
export const BILLING_CREATE_TARGET_ROLE_KEYS = ["pm"] as const;

// pm에 billing:create 멱등 grant. 이미 적용(플래그 존재)이면 no-op.
// fail-closed: 대상 역할·권한 중 하나라도 없으면 throw(플래그 미설정) → 다음 seed 재시도. 플래그는 모든 upsert 성공 후에만 set.
export async function applyBillingCreatePermissionUpgrade(
  db: UpgradeClient,
  roleIdByKey: Map<string, string>,
  permissionIdByKey: Map<string, string>,
): Promise<{ applied: boolean }> {
  const already = await db.systemSetting.findUnique({ where: { key: BILLING_CREATE_UPGRADE_FLAG } });
  if (already) return { applied: false };
  const roleIds = BILLING_CREATE_TARGET_ROLE_KEYS.map((key) => {
    const id = roleIdByKey.get(key);
    if (!id) throw new Error(`billing-create-upgrade: '${key}' 역할 미존재(seed 순서/드리프트) — 플래그 미설정, 재시도`);
    return id;
  });
  const grants = BILLING_CREATE_GRANT_KEYS.map((key) => {
    const pid = permissionIdByKey.get(key);
    if (!pid) throw new Error(`billing-create-upgrade: 권한 '${key}' 미존재 — 플래그 미설정, 재시도`);
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
  await db.systemSetting.create({ data: { key: BILLING_CREATE_UPGRADE_FLAG, value: { appliedAt: "bootstrap" } } });
  return { applied: true };
}
