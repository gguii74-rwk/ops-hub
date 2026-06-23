import "server-only";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/kernel/access";

export interface MatrixData {
  roles: Array<{ id: string; key: string; name: string }>;
  permissions: Array<{ id: string; resource: string; action: string }>;
  rules: Array<{ roleId: string; permissionId: string; effect: "ALLOW" | "DENY"; scope: string }>;
}

export async function getMatrix(): Promise<MatrixData> {
  const [roles, permissions, rules] = await Promise.all([
    prisma.accessRole.findMany({ orderBy: { key: "asc" }, select: { id: true, key: true, name: true } }),
    prisma.permission.findMany({ orderBy: [{ resource: "asc" }, { action: "asc" }], select: { id: true, resource: true, action: true } }),
    prisma.rolePermission.findMany({ select: { roleId: true, permissionId: true, effect: true, scope: true } }),
  ]);
  return { roles, permissions, rules };
}

// 매트릭스 셀(roleId,permissionId) 단위 advisory lock 네임스페이스 — leave(0x6c76)/nav(0x6e76)와 충돌 방지.
const ROLE_MATRIX_LOCK_NS = 0x726d; // 'rm'

// scope가 unique 키의 일부라 scope 변경 = 행 치환. 같은 (role,permission)의 모든 scope 행을 지우고 none이 아니면 1행 생성.
// F-H: OWNER 권위 점검을 **이 쓰기 트랜잭션 내부에서** actor를 잠그고 재확인한다. 서비스의 assertOwner는 빠른 pre-check일 뿐,
// precheck 이후 actor가 강등(OWNER→ADMIN)·비활성·must-change로 바뀌면 stale 권한으로 매트릭스(최고위험 op)를 바꿀 수 있다.
// F-BB: 같은 셀 동시 편집을 직렬화. actor 행 잠금은 actor 기준이라 서로 다른 OWNER 2명의 동일 셀 편집을 막지 못한다.
// scope가 unique 키(@@unique([roleId,permissionId,scope]))에 포함돼, delete-all-then-create가 직렬화되지 않으면
// READ COMMITTED에서 scope가 다른 두 쓰기가 모두 커밋 → 한 셀에 숨은 중복 행. access engine은 전 행을 평가하므로
// (decision.ts) UI에 안 보이는 행이 결정을 뒤집을 수 있다. 셀 단위 advisory xact lock으로 임계구역 전체를 직렬화.
export async function setCell(
  roleId: string, permissionId: string,
  effect: "none" | "ALLOW" | "DENY", scope: string, actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // F-BB: 셀 단위 advisory lock을 가장 먼저 잡는다(actor 무관 직렬화). pg_advisory_xact_lock은 void 반환 →
    // $queryRaw는 P2010 실패, 실행만 하는 $executeRaw 사용(leave/nav/users 동형). 트랜잭션 종료(커밋/롤백) 시 자동 해제.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROLE_MATRIX_LOCK_NS}::int4, hashtext(${`${roleId}:${permissionId}`}))`;
    // actor 행 잠금 + 현재 OWNER/상태 재확인(precheck 이후 강등 race 차단). 동시 강등 UPDATE와 직렬화.
    await tx.$queryRaw`SELECT 1 FROM "kernel"."User" WHERE "id" = ${actorId} FOR UPDATE`;
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { systemRole: true, status: true, mustChangePassword: true } });
    if (!actor || actor.status !== "ACTIVE" || actor.mustChangePassword || actor.systemRole !== "OWNER") {
      throw new ForbiddenError("권한 매트릭스 편집은 OWNER만 가능합니다."); // 롤백 — 셀 변경·감사 없음
    }
    const before = await tx.rolePermission.findFirst({ where: { roleId, permissionId }, select: { effect: true, scope: true } });
    await tx.rolePermission.deleteMany({ where: { roleId, permissionId } });
    if (effect !== "none") {
      await tx.rolePermission.create({ data: { roleId, permissionId, effect, scope } });
    }
    await tx.auditLog.create({
      data: { actorId, entityType: "RolePermission", entityId: `${roleId}:${permissionId}`, action: "matrix.setCell",
        metadata: { before: before ?? null, after: effect === "none" ? null : { effect, scope } } },
    });
  });
}
