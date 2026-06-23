import "server-only";
import { prisma } from "@/lib/prisma";
import { requirePermission, ForbiddenError, allowedScopes } from "@/kernel/access";
import { getMatrix, setCell, type MatrixData } from "../repositories";
import type { SetCellInput } from "../validations";

// 라우트 키(admin.roles:view)는 라우트가 검사. 매트릭스 로드는 view 권한이면 충분(위임 admin도 본다).
export function getRoleMatrix(): Promise<MatrixData> {
  return getMatrix();
}

// fail-closed OWNER 게이트(loadUserContext와 동형). configure 키(OWNER 전용 시드)와 별개의 방어선(D7).
async function assertOwner(actorId: string): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: actorId }, select: { systemRole: true, status: true, mustChangePassword: true } });
  if (!u || u.status !== "ACTIVE" || u.mustChangePassword || u.systemRole !== "OWNER") {
    throw new ForbiddenError("권한 매트릭스 편집은 OWNER만 가능합니다.");
  }
}

export async function setRoleCell(actorId: string, roleId: string, permissionId: string, input: SetCellInput): Promise<void> {
  // 1) configure 키(OWNER 전용 시드 → OWNER만 통과) + 2) 명시적 OWNER 단언(빠른 pre-check, D7).
  //    ※ 권위 OWNER 점검은 setCell **트랜잭션 내부**에서 actor를 잠그고 재확인(F-H — precheck 이후 강등 race 차단). 여기 둘은 fast-fail.
  await requirePermission(actorId, "admin.roles", "configure");
  await assertOwner(actorId);

  const role = await prisma.accessRole.findUnique({ where: { id: roleId }, select: { key: true } });
  if (!role) throw new ForbiddenError("역할을 찾을 수 없습니다.");
  if (role.key === "pm") throw new ForbiddenError("pm 역할은 편집할 수 없습니다."); // D6 read-only

  const perm = await prisma.permission.findUnique({ where: { id: permissionId }, select: { resource: true, action: true } });
  if (!perm) throw new ForbiddenError("권한을 찾을 수 없습니다.");

  // anti-escalation: admin.roles:configure는 매트릭스로 부여 불가(OWNER systemRole 전용 유지, D7).
  if (perm.resource === "admin.roles" && perm.action === "configure" && input.effect === "ALLOW") {
    throw new ForbiddenError("admin.roles:configure는 역할에 부여할 수 없습니다(OWNER 전용).");
  }

  // scope 제약(PD2): ALLOW의 비-all scope는 scopeable resource(leave.approval)만. 그 외엔 all 강제.
  let scope = input.scope;
  if (input.effect === "ALLOW" && scope !== "all" && !allowedScopes(perm.resource).includes(scope)) {
    throw new ForbiddenError(`${perm.resource}는 ${scope} scope를 지원하지 않습니다.`);
  }
  if (input.effect === "DENY") scope = "all"; // DENY는 scope-무관(computeDecision) → 정규화.

  await setCell(roleId, permissionId, input.effect, scope, actorId);
}
