import "server-only";
import { prisma, type PrismaTx } from "@/lib/prisma";
import { computeDecision, permissionKey, type PermissionRule, type Scope, type Action } from "@/kernel/access/decision";
import { getEffectiveScope, SCOPE_RANK, type EnforceableScope } from "@/kernel/access";
import type { Prisma } from "@prisma/client";
import { EscalationError, MinAvailabilityError } from "@/modules/admin/users/errors";
import {
  isPrivilegedRoleKey,
  PRIVILEGED_SYSTEM_ROLES,
  CRITICAL_RESOURCE_PREFIXES,
  USER_MGMT_PERMISSION,
  AUDIT_PERMISSION,
} from "@/modules/admin/users/policy";

// 행위자 컨텍스트 — 라우트에서 세션 + getPermissionSummary로 구성(entrypoint §S5).
export interface ActorContext {
  userId: string;
  isOwner: boolean;            // systemRole === "OWNER"
  permissionKeys: Set<string>; // getPermissionSummary().keys
}

// 전역 직렬화용 advisory lock 키(고정 상수). 모든 availability-affecting mutation을 한 줄로 세운다.
const AVAILABILITY_LOCK_KEY = 4815162342n;

// 권한 키가 critical(admin.*) prefix에 속하는지.
function isCriticalKey(key: string): boolean {
  return CRITICAL_RESOURCE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// D13ⓐ — 비-OWNER는 자기 자신을 대상으로 한 권한 mutation을 할 수 없다(자가 상승 차단).
export function assertNotSelfMutation(actor: ActorContext, targetUserId: string): void {
  if (actor.isOwner) return;
  if (actor.userId === targetUserId) {
    throw new EscalationError("자기 자신의 권한·상태는 변경할 수 없습니다.");
  }
}

// D13ⓑ — 특권 역할(pm·admin)의 **부여·회수 양쪽**이 OWNER-only. 현재(currentRoleKeys)와 원하는(nextRoleKeys)
// 집합의 **차집합**(추가된 것 ∪ 제거된 것) 중 특권 역할이 하나라도 있으면 비-OWNER는 거부한다.
// 추가 차단뿐 아니라 위임 admin이 목록에서 빼는 방식으로 기존 pm/admin을 떼어내 동료를 lockout하는 것도 막는다(finding C).
export function assertCanAssignRoles(
  actor: ActorContext, currentRoleKeys: string[], nextRoleKeys: string[],
): void {
  if (actor.isOwner) return;
  const current = new Set(currentRoleKeys);
  const next = new Set(nextRoleKeys);
  // 차집합: 추가(next에는 있고 current엔 없음) ∪ 제거(current엔 있고 next엔 없음).
  const added = nextRoleKeys.filter((k) => !current.has(k));
  const removed = currentRoleKeys.filter((k) => !next.has(k));
  const touchedPrivileged = [...added, ...removed].filter(isPrivilegedRoleKey);
  if (touchedPrivileged.length > 0) {
    throw new EscalationError(`특권 역할(${[...new Set(touchedPrivileged)].join(", ")}) 부여·회수는 OWNER만 가능합니다.`);
  }
}

// D12 — **현재 또는 원하는** systemRole이 OWNER/ADMIN을 건드리면 OWNER-only. 특권으로 승격하는 것뿐 아니라
// 기존 OWNER/ADMIN을 MEMBER/MANAGER로 강등하는 것도 비-OWNER는 거부한다(finding C — 강등으로 동료 특권 제거 방지).
// newRole이 null이면 systemRole 변경 의도 없음이지만, 현재가 특권이면(가용성 영향) 여전히 OWNER-only로 본다.
export function assertCanSetSystemRole(
  actor: ActorContext, currentRole: string, newRole: string | null,
): void {
  if (actor.isOwner) return;
  const privileged = PRIVILEGED_SYSTEM_ROLES as readonly string[];
  if (privileged.includes(currentRole)) {
    throw new EscalationError(`현재 ${currentRole} systemRole의 변경은 OWNER만 가능합니다.`);
  }
  if (newRole !== null && privileged.includes(newRole)) {
    throw new EscalationError(`${newRole} systemRole 부여는 OWNER만 가능합니다.`);
  }
}

// D13ⓒ — 비-critical ALLOW override는 actor가 실제 보유한 권한 한도 내에서만(가진 것 이상 못 줌, scope도 포함).
// D13ⓓ — critical(admin.*) 권한 override는 effect 무관(ALLOW·DENY 모두) OWNER-only.
//   ALLOW: 위임 admin이 `admin.users:update` 등을 보유하더라도 ALLOW override로 타인에게 동등 admin 권한을
//          우회 부여하는 것 차단(보호된 역할/systemRole 부여 없이 OWNER-only 위임 경계 우회 방지 — finding D).
//   DENY:  동료 관리자를 critical 권한에서 lockout 하는 것 차단.
// F-N: ALLOW 부여 시 actor의 effectiveScope를 in-tx 재해석해 scope도 보유 한도 내인지 확인.
// F-EE: team scope는 grantee 팀 기준 상대값이라 rank 검사만으론 부족하다. team-scope actor가 team-scope ALLOW를
//   부여하면 grantee의 *grantee 팀*에 대한 권능이 생긴다 — grantee가 다른 팀이면 actor가 권한 없는 팀에 권능을
//   만들어내는 cross-team 위임(상승). 그래서 targetUserId를 받아 actorScope==="team"일 때 같은 팀만 허용한다.
export async function assertOverrideWithinActorGrant(
  actor: ActorContext, targetUserId: string, resource: string, action: string, effect: "ALLOW" | "DENY", scope: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  // F-HH: actor.isOwner는 route 시점 ActorContext(stale)다. 호출부가 actor 행을 FOR UPDATE로 잠근(F-Q) 뒤 호출하므로
  //   in-tx 최신 systemRole/status/mustChangePassword를 다시 읽어 권위를 유도한다(F-H setCell 동형). route auth 이후
  //   강등/비활성/must-change된 actor가 stale OWNER 권한으로 critical override를 만들거나 미보유 scope를 부여하는 race 차단(fail-closed).
  const client = tx ?? prisma;
  const fresh = await client.user.findUnique({
    where: { id: actor.userId },
    select: { systemRole: true, status: true, mustChangePassword: true },
  });
  if (!fresh || fresh.status !== "ACTIVE" || fresh.mustChangePassword) {
    throw new EscalationError("비활성·임시 비밀번호 상태에서는 권한 예외를 변경할 수 없습니다.");
  }
  if (fresh.systemRole === "OWNER") return;
  const key = permissionKey(resource, action);
  // critical 권한은 effect와 무관하게 OWNER-only(actor가 보유하고 있어도 ALLOW 불가).
  if (isCriticalKey(key)) {
    throw new EscalationError(`critical 권한(${key})에 대한 override(${effect})는 OWNER만 가능합니다.`);
  }
  // 이하 비-critical 권한.
  if (effect === "ALLOW") {
    const actorScope = await getEffectiveScope(actor.userId, resource, action as Action, tx);
    if (actorScope == null) throw new EscalationError(`보유하지 않은 권한(${key})은 ALLOW로 부여할 수 없습니다.`);
    if (scope === "assigned" || SCOPE_RANK[scope as EnforceableScope] > SCOPE_RANK[actorScope]) {
      throw new EscalationError(`보유 scope(${actorScope})를 넘는 ${scope} 권한은 부여할 수 없습니다.`);
    }
    // F-EE: actor가 team scope만 보유하고 team scope를 부여하면, grantee가 actor와 같은 팀일 때만 허용한다.
    // actorScope="all"이면 전 팀을 커버하므로 무관. team-scope actor의 cross-team ALLOW만 차단(교차 팀 권한 위임 금지).
    if (scope === "team" && actorScope === "team") {
      const client = tx ?? prisma;
      const [actorRow, targetRow] = await Promise.all([
        client.user.findUnique({ where: { id: actor.userId }, select: { teamId: true } }),
        client.user.findUnique({ where: { id: targetUserId }, select: { teamId: true } }),
      ]);
      if (actorRow?.teamId == null || actorRow.teamId !== targetRow?.teamId) {
        throw new EscalationError(`team scope 권한(${key})은 같은 팀 사용자에게만 부여할 수 있습니다(교차 팀 위임 금지).`);
      }
    }
  }
  // 비-critical DENY는 허용.
}

// ── 최소 가용성(D13ⓔ) — advisory lock 직렬화 + 커밋 전 재검사 ──

// availability-affecting mutation을 감싸는 트랜잭션 래퍼. 시작에서 전역 advisory xact lock을 잡아
// 동시 mutation을 한 줄로 직렬화한다(트랜잭션 종료 시 자동 해제 — xact lock).
export async function withAvailabilityLock<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AVAILABILITY_LOCK_KEY})`;
    return fn(tx);
  });
}

// 커밋 전 호출. ① ACTIVE OWNER 보존(D12·finding 1) ② 가용 user-management 관리자 ③ 가용 audit 조회자가 각각 1명 미만이면 거부.
export async function assertMinAvailability(tx: PrismaTx): Promise<void> {
  // finding 1: 권한 카운트와 별개로 최소 1명의 "사용 가능한" ACTIVE OWNER를 보존한다. mutation 후·커밋 전 상태를 보므로
  // 마지막 OWNER 강등(updateUserTx systemRole)·비활성(setStatusTx disable)이 즉시 카운트에서 빠져 차단된다.
  // (위임 admin이 user-management·audit 권한을 모두 충족해도 OWNER가 0이면 OWNER-only 복구가 막히는 lockout 방지.)
  // mustChangePassword=true OWNER는 권한 엔진이 fail-closed로 전부 거부(task-07)해 OWNER 권능을 못 쓰므로 "사용 가능"이 아니다.
  // countAvailableByPermission의 "가용(ACTIVE && mustChangePassword===false)" 정의와 일치시킨다 —
  // 안 그러면 임시비번 미완료 OWNER만 남았는데 마지막 사용가능 OWNER를 강등/비활성해 OWNER-only 복구가 막히는 lockout이 통과한다.
  const owners = await tx.user.count({ where: { systemRole: "OWNER", status: "ACTIVE", mustChangePassword: false } });
  if (owners < 1) {
    throw new MinAvailabilityError("최소 1명의 활성 OWNER가 남아야 합니다.");
  }
  const userMgmt = await countAvailableByPermission(tx, USER_MGMT_PERMISSION);
  if (userMgmt < 1) {
    throw new MinAvailabilityError("최소 1명의 가용 사용자 관리자가 남아야 합니다.");
  }
  const audit = await countAvailableByPermission(tx, AUDIT_PERMISSION);
  if (audit < 1) {
    throw new MinAvailabilityError("최소 1명의 가용 감사 조회자가 남아야 합니다.");
  }
}

// 유효기간 내 규칙만 인정(access/index.ts withinValidity와 동형).
function withinValidity(startsAt: Date | null, endsAt: Date | null, now: Date): boolean {
  if (startsAt && startsAt > now) return false;
  if (endsAt && endsAt < now) return false;
  return true;
}

// permissionKey가 "resource:action"이라 마지막 ':'로 분리(resource에 '.'은 있으나 ':'은 없음).
function splitKey(key: string): { resource: string; action: string } {
  const i = key.lastIndexOf(":");
  return { resource: key.slice(0, i), action: key.slice(i + 1) };
}

// "가용(available)" = status==="ACTIVE" && mustChangePassword===false 인 사용자 중,
// computeDecision(override+role) 또는 OWNER로 permissionKey를 보유한 사람 수.
// computeDecision을 재사용해 Deny우선·fail-closed 규칙을 권한 엔진과 일치시킨다.
export async function countAvailableByPermission(tx: PrismaTx, permissionKeyStr: string): Promise<number> {
  const now = new Date();
  const { resource, action } = splitKey(permissionKeyStr);

  const permission = await tx.permission.findUnique({
    where: { resource_action: { resource, action } },
    select: { id: true },
  });
  // 권한 정의 자체가 없으면 OWNER만 보유로 친다(권한 엔진과 동일: 비-OWNER는 미정의 권한 미보유).
  const permissionId = permission?.id ?? null;

  const candidates = await tx.user.findMany({
    where: { status: "ACTIVE", mustChangePassword: false },
    select: {
      systemRole: true,
      roleAssignments: { select: { roleId: true, startsAt: true, endsAt: true } },
      permissionOverrides: permissionId
        ? {
            where: { permissionId },
            select: { effect: true, scope: true, startsAt: true, endsAt: true },
          }
        : false,
    },
  });

  // 비-OWNER 후보가 보유한 역할 → 해당 permission의 RolePermission 규칙을 한 번에 로드.
  const roleIds = Array.from(
    new Set(
      candidates
        .filter((u) => u.systemRole !== "OWNER")
        .flatMap((u) => u.roleAssignments.filter((a) => withinValidity(a.startsAt, a.endsAt, now)).map((a) => a.roleId)),
    ),
  );
  const rolePerms =
    permissionId && roleIds.length
      ? await tx.rolePermission.findMany({
          where: { permissionId, roleId: { in: roleIds } },
          select: { roleId: true, effect: true, scope: true },
        })
      : [];
  const ruleByRole = new Map<string, PermissionRule[]>();
  for (const rp of rolePerms) {
    const list = ruleByRole.get(rp.roleId) ?? [];
    list.push({ effect: rp.effect, scope: rp.scope as Scope });
    ruleByRole.set(rp.roleId, list);
  }

  let count = 0;
  for (const u of candidates) {
    if (u.systemRole === "OWNER") {
      count += 1;
      continue;
    }
    const overrides: PermissionRule[] = (u.permissionOverrides ?? [])
      .filter((o) => withinValidity(o.startsAt, o.endsAt, now))
      .map((o) => ({ effect: o.effect, scope: o.scope as Scope }));
    const roleRules: PermissionRule[] = u.roleAssignments
      .filter((a) => withinValidity(a.startsAt, a.endsAt, now))
      .flatMap((a) => ruleByRole.get(a.roleId) ?? []);
    if (computeDecision({ isOwner: false, overrides, roleRules })) count += 1;
  }
  return count;
}

// permissionKey re-export (라우트/서비스가 키 조립 시 동일 헬퍼 사용 — 일관성).
export { permissionKey };
