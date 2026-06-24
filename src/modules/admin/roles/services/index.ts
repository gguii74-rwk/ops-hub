import "server-only";
import { prisma } from "@/lib/prisma";
import { requirePermission, ForbiddenError, allowedScopes, type EnforceableScope } from "@/kernel/access";
import { NON_PRIVILEGED_ROLE_KEYS, CRITICAL_RESOURCE_PREFIXES } from "@/modules/admin/users/policy";
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

// pm 역할은 read-only(D6). 단건/묶음 공통 role-level 가드.
function assertRoleEditable(roleKey: string): void {
  if (roleKey === "pm") throw new ForbiddenError("pm 역할은 편집할 수 없습니다.");
}

// 단건/묶음이 공유하는 per-permission 가드. 통과 시 정규화된 scope 반환, 위반 시 ForbiddenError(사유 포함).
// ※ 메시지 문자열은 기존 setRoleCell의 것을 그대로 옮긴 것 — 변경 금지(테스트가 메시지로 단언).
export function assertCellAllowed(
  roleKey: string,
  perm: { resource: string; action: string },
  effect: "none" | "ALLOW" | "DENY",
  scope: string,
): string {
  // anti-escalation: admin.roles:configure는 매트릭스로 부여 불가(OWNER systemRole 전용 유지, D7).
  if (perm.resource === "admin.roles" && perm.action === "configure" && effect === "ALLOW") {
    throw new ForbiddenError("admin.roles:configure는 역할에 부여할 수 없습니다(OWNER 전용).");
  }
  // F-NN: 비특권 role에 critical(admin.*) 권한을 ALLOW로 실으면 role-assignment 정적 분류가 fail-open → 차단.
  //   DENY는 권한 제거라 상승 아님 → 허용.
  if (
    effect === "ALLOW" &&
    (NON_PRIVILEGED_ROLE_KEYS as readonly string[]).includes(roleKey) &&
    CRITICAL_RESOURCE_PREFIXES.some((prefix) => perm.resource.startsWith(prefix))
  ) {
    throw new ForbiddenError(`비특권 역할(${roleKey})에는 critical 권한(${perm.resource})을 부여할 수 없습니다(권한 상승 차단).`);
  }
  // scope 제약(PD2): ALLOW의 비-all scope는 scopeable resource(leave.approval)만. 그 외엔 all 강제.
  let s = scope;
  if (effect === "ALLOW" && s !== "all" && !allowedScopes(perm.resource).includes(s as EnforceableScope)) {
    throw new ForbiddenError(`${perm.resource}는 ${s} scope를 지원하지 않습니다.`);
  }
  if (effect === "DENY") s = "all"; // DENY는 scope-무관(computeDecision) → 정규화.
  return s;
}

export async function setRoleCell(actorId: string, roleId: string, permissionId: string, input: SetCellInput): Promise<void> {
  // 1) configure 키(OWNER 전용 시드 → OWNER만 통과) + 2) 명시적 OWNER 단언(빠른 pre-check, D7).
  //    ※ 권위 OWNER 점검은 setCell **트랜잭션 내부**에서 actor를 잠그고 재확인(F-H). 여기 둘은 fast-fail.
  await requirePermission(actorId, "admin.roles", "configure");
  await assertOwner(actorId);

  const role = await prisma.accessRole.findUnique({ where: { id: roleId }, select: { key: true } });
  if (!role) throw new ForbiddenError("역할을 찾을 수 없습니다.");
  assertRoleEditable(role.key); // D6 read-only

  const perm = await prisma.permission.findUnique({ where: { id: permissionId }, select: { resource: true, action: true } });
  if (!perm) throw new ForbiddenError("권한을 찾을 수 없습니다.");

  const scope = assertCellAllowed(role.key, perm, input.effect, input.scope);
  await setCell(roleId, permissionId, input.effect, scope, actorId);
}

export interface BulkResult {
  applied: number;
  skipped: Array<{ key: string; reason: string }>;
}

// 묶음 부여(D6/D7) — resourcePrefix 첫 세그먼트에 매칭되는 권한을 순회하며 per-cell 가드+setCell을 재사용.
// OWNER/configure는 1회 pre-check, 권위 OWNER 재확인은 setCell 트랜잭션 내부에서 셀마다 유지(F-H 불변).
// 가드(ForbiddenError)에 걸리는 셀은 건너뛰고 사유를 모은다(부분 적용). 그 외 예외는 버블.
export async function setRoleCellsBulk(
  actorId: string, roleId: string, resourcePrefix: string, effect: "none" | "ALLOW" | "DENY",
): Promise<BulkResult> {
  await requirePermission(actorId, "admin.roles", "configure");
  await assertOwner(actorId);

  const role = await prisma.accessRole.findUnique({ where: { id: roleId }, select: { key: true } });
  if (!role) throw new ForbiddenError("역할을 찾을 수 없습니다.");
  assertRoleEditable(role.key);

  const perms = await prisma.permission.findMany({
    where: { OR: [{ resource: resourcePrefix }, { resource: { startsWith: `${resourcePrefix}.` } }] },
    select: { id: true, resource: true, action: true },
    orderBy: [{ resource: "asc" }, { action: "asc" }],
  });

  let applied = 0;
  const skipped: Array<{ key: string; reason: string }> = [];
  for (const perm of perms) {
    try {
      const scope = assertCellAllowed(role.key, perm, effect, "all"); // 묶음은 scope all 고정(D5)
      await setCell(roleId, perm.id, effect, scope, actorId);
      applied++;
    } catch (e) {
      if (e instanceof ForbiddenError) {
        skipped.push({ key: `${perm.resource}:${perm.action}`, reason: e.message });
        continue;
      }
      throw e; // 예기치 못한(DB 등) 오류는 버블 → 라우트 500
    }
  }
  return { applied, skipped };
}
