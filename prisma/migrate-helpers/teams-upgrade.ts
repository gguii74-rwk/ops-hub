// 클라이언트 표면 최소화(실 PrismaClient·테스트 mock 둘 다 충족).
export interface UpgradeClient {
  systemSetting: {
    findUnique(a: { where: { key: string } }): Promise<{ key: string } | null>;
    create(a: { data: { key: string; value: unknown } }): Promise<unknown>;
  };
  rolePermission: {
    upsert(a: {
      where: { roleId_permissionId_scope: { roleId: string; permissionId: string; scope: string } };
      update: Record<string, never>;
      create: { roleId: string; permissionId: string; effect: "ALLOW"; scope: string };
    }): Promise<unknown>;
  };
}

export const UPGRADE_FLAG = "migration.teams-permission-matrix.upgrade.applied";
export const UPGRADE_GRANT_KEYS = ["admin.teams:view", "admin.teams:configure", "admin.roles:view"] as const;
// 신규 grant 대상 역할: 위임 admin + pm. F-KK: fresh install은 pm:"*"로 이 권한들을 받지만 기존 install은 bootstrap을
// 건너뛰므로(count>0) pm이 신규 권한을 못 받아 설치-이력 의존 드리프트가 생긴다(매트릭스에서 pm은 편집 불가라 OWNER도
// 복구 못 함) → 업그레이드가 admin뿐 아니라 pm도 reconcile해 fresh/existing install 권한을 일치시킨다.
export const UPGRADE_TARGET_ROLE_KEYS = ["admin", "pm"] as const;

// 위임 admin·pm에 신규 grant upsert(F4·F-KK). 이미 적용(플래그 존재)이면 no-op. roleIdByKey/permissionIdByKey는 seed가 채운 맵.
// F-K fail-closed: 전제(대상 역할 전부 + 모든 신규 grant permission)가 하나라도 없으면 **throw**(플래그 미설정) —
// seed 순서/카탈로그 드리프트로 grant를 건너뛴 채 영구 "applied"로 마킹되는 fail-open을 막는다. 플래그는 **모든 upsert 성공 후**에만.
export async function applyTeamsPermissionUpgrade(
  db: UpgradeClient,
  roleIdByKey: Map<string, string>,
  permissionIdByKey: Map<string, string>,
): Promise<{ applied: boolean }> {
  const already = await db.systemSetting.findUnique({ where: { key: UPGRADE_FLAG } });
  if (already) return { applied: false };
  // 대상 역할 id를 먼저 해석(하나라도 없으면 throw — upsert/플래그 전에 중단).
  const roleIds = UPGRADE_TARGET_ROLE_KEYS.map((key) => {
    const id = roleIdByKey.get(key);
    if (!id) throw new Error(`teams-upgrade: '${key}' 역할 미존재(seed 순서/드리프트) — 플래그 미설정, 다음 seed에서 재시도`);
    return id;
  });
  // 모든 grant permission id를 먼저 해석(하나라도 없으면 throw — upsert/플래그 전에 중단).
  const grants = UPGRADE_GRANT_KEYS.map((key) => {
    const pid = permissionIdByKey.get(key);
    if (!pid) throw new Error(`teams-upgrade: 권한 '${key}' 미존재 — 플래그 미설정, 재시도 필요`);
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
  await db.systemSetting.create({ data: { key: UPGRADE_FLAG, value: { appliedAt: "bootstrap" } } }); // 모든 upsert 성공 후에만
  return { applied: true };
}
