import { expandRoleCells, type Cell } from "../seed-roles";

// 클라이언트 표면 최소화(실 PrismaClient·테스트 mock 둘 다 충족). teams-upgrade UpgradeClient 동형.
export interface BootstrapClient {
  rolePermission: {
    count(): Promise<number>;
    createMany(a: {
      data: Array<{ roleId: string; permissionId: string; effect: "ALLOW"; scope: string }>;
      skipDuplicates?: boolean;
    }): Promise<unknown>;
  };
}

// 부트스트랩-if-empty(D9): RolePermission 행이 0개일 때만 ROLE_ALLOW로 시드한다.
// F-AA fail-atomic: **반드시 단일 트랜잭션 내에서 호출**(seed.ts가 prisma.$transaction으로 감쌈). count 검사+전 역할
// createMany가 원자적이지 않으면 — 일부 역할 createMany 성공 후 중단 시 — retry가 count>0을 보고 나머지 ROLE_ALLOW
// grant를 영구히 건너뛴다(잠긴/위임 역할 포함 불완전 매트릭스 고착). 트랜잭션으로 감싸면 부분 실패가 롤백돼 count 0이
// 유지되고 다음 seed가 전체를 다시 시드한다. count 검사도 tx 안에서 수행(원자 단위에 포함).
export async function bootstrapRolePermissions(
  db: BootstrapClient,
  roles: Array<{ key: string }>,
  roleAllow: Record<string, Cell[]>,
  roleIdByKey: Map<string, string>,
  permissionIdByKey: Map<string, string>,
): Promise<{ seeded: boolean }> {
  if ((await db.rolePermission.count()) > 0) return { seeded: false }; // 이미 부트스트랩됨 — 기존 행(UI 편집 포함) 보존
  const allKeys = [...permissionIdByKey.keys()];
  for (const role of roles) {
    const wanted = roleAllow[role.key] ?? [];
    const roleId = roleIdByKey.get(role.key)!;
    const cells = expandRoleCells(wanted, allKeys); // "*" 확장 + OWNER_ONLY_KEYS 제외(F-L)
    const rows = cells
      .map(([key, scope]) => {
        const pid = permissionIdByKey.get(key);
        return pid ? { roleId, permissionId: pid, effect: "ALLOW" as const, scope } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    await db.rolePermission.createMany({ data: rows, skipDuplicates: true });
  }
  return { seeded: true };
}
