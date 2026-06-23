import { prisma, type PrismaTx } from "@/lib/prisma";
import { computeDecision, permissionKey } from "@/kernel/access/decision";
import type { Action, PermissionRule, Scope } from "@/kernel/access/decision";
import { effectiveScope, allowedScopes, type EnforceableScope } from "@/kernel/access/scope";

// 엔진 함수가 트랜잭션/전역 클라이언트 양쪽을 받도록(F-O). PrismaClient 정밀 타입 대신 prisma 인스턴스 타입 재사용.
type PrismaClientOrTx = typeof prisma | PrismaTx;

export * from "@/kernel/access/decision";
export * from "@/kernel/access/catalog";
export * from "@/kernel/access/scope";

export interface PermissionSummary {
  keys: string[];
  isOwner: boolean; // 신규(finding 3) — actor 권위 단일 출처. must-change/비활성이면 false(fail-closed).
  isAdmin: boolean; // 신규 — coarse 관리자(OWNER||ADMIN) 권위 단일 출처. must-change/비활성이면 false(fail-closed). 소비처가 session.systemRole에서 직접 도출하면 게이트 우회됨.
}

export class ForbiddenError extends Error {
  constructor(message = "권한이 없습니다.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

function withinValidity(startsAt: Date | null, endsAt: Date | null, now: Date): boolean {
  if (startsAt && startsAt > now) return false;
  if (endsAt && endsAt < now) return false;
  return true;
}

interface UserContext {
  isOwner: boolean;
  isAdmin: boolean; // OWNER||ADMIN(coarse). must-change/비활성 게이트는 호출부가 먼저 early-return.
  roleIds: string[];
  mustChangePassword: boolean; // 신규 — must-change 세션은 모든 권한 fail-closed(D17)
}

async function loadUserContext(userId: string, now: Date, client: PrismaClientOrTx = prisma): Promise<UserContext | null> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      systemRole: true,
      status: true,
      mustChangePassword: true,
      roleAssignments: { select: { roleId: true, startsAt: true, endsAt: true } },
    },
  });
  if (!user) return null;
  if (user.status !== "ACTIVE") return null;
  const roleIds = user.roleAssignments
    .filter((a) => withinValidity(a.startsAt, a.endsAt, now))
    .map((a) => a.roleId);
  return {
    isOwner: user.systemRole === "OWNER",
    isAdmin: user.systemRole === "OWNER" || user.systemRole === "ADMIN",
    roleIds,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function hasPermission(userId: string, resource: string, action: Action): Promise<boolean> {
  const now = new Date();
  const ctx = await loadUserContext(userId, now);
  if (!ctx) return false;
  // D17 하드 게이트: must-change 세션은 어떤 권한도 갖지 않는다(OWNER 포함). change-password/logout 경로는 권한 검사를 거치지 않음.
  if (ctx.mustChangePassword) return false;
  if (ctx.isOwner) return true;

  const permission = await prisma.permission.findUnique({
    where: { resource_action: { resource, action } },
    select: { id: true },
  });
  if (!permission) return false;

  const [overrideRows, roleRows] = await Promise.all([
    prisma.userPermissionOverride.findMany({
      where: { userId, permissionId: permission.id },
      select: { effect: true, scope: true, startsAt: true, endsAt: true },
    }),
    ctx.roleIds.length
      ? prisma.rolePermission.findMany({
          where: { permissionId: permission.id, roleId: { in: ctx.roleIds } },
          select: { effect: true, scope: true },
        })
      : Promise.resolve([]),
  ]);

  const overrides: PermissionRule[] = overrideRows
    .filter((r) => withinValidity(r.startsAt, r.endsAt, now))
    .map((r) => ({ effect: r.effect, scope: r.scope as Scope }));
  const roleRules: PermissionRule[] = roleRows.map((r) => ({ effect: r.effect, scope: r.scope as Scope }));

  return computeDecision({ isOwner: false, overrides, roleRules });
}

export async function requirePermission(userId: string, resource: string, action: Action): Promise<void> {
  const ok = await hasPermission(userId, resource, action);
  if (!ok) throw new ForbiddenError(`${permissionKey(resource, action)} 권한이 없습니다.`);
}

/**
 * 허가된 가장 넓은 enforceable scope(all>team>own) 또는 null. computeDecision 우선순위의 일반화.
 * OWNER→all, must-change·비활성→null(fail-closed). hasPermission/requirePermission 계약과 별개의 추가 함수.
 * `client`(기본 prisma): 트랜잭션 내부에서 **현재** 권한 상태로 재해석하려면 tx 클라이언트를 넘긴다(F-O — 승인 tx가
 * precheck 신뢰 대신 in-tx 재해석).
 */
export async function getEffectiveScope(
  userId: string, resource: string, action: Action,
  client: PrismaClientOrTx = prisma,
): Promise<EnforceableScope | null> {
  const now = new Date();
  const ctx = await loadUserContext(userId, now, client);
  if (!ctx) return null;
  if (ctx.mustChangePassword) return null; // D17 하드 게이트
  if (ctx.isOwner) return "all";

  const permission = await client.permission.findUnique({
    where: { resource_action: { resource, action } },
    select: { id: true },
  });
  if (!permission) return null;

  const [overrideRows, roleRows] = await Promise.all([
    client.userPermissionOverride.findMany({
      where: { userId, permissionId: permission.id },
      select: { effect: true, scope: true, startsAt: true, endsAt: true },
    }),
    ctx.roleIds.length
      ? client.rolePermission.findMany({
          where: { permissionId: permission.id, roleId: { in: ctx.roleIds } },
          select: { effect: true, scope: true },
        })
      : Promise.resolve([]),
  ]);

  const overrides: PermissionRule[] = overrideRows
    .filter((r) => withinValidity(r.startsAt, r.endsAt, now))
    .map((r) => ({ effect: r.effect, scope: r.scope as Scope }));
  const roleRules: PermissionRule[] = roleRows.map((r) => ({ effect: r.effect, scope: r.scope as Scope }));

  // F-A: resource가 허용하는 scope로 clamp. 비-scopeable resource는 ["all"]이라 team/own grant가 후보에서 빠진다
  // (override-panel로 만든 비-scopeable team override가 메뉴/데이터로 새는 것 차단). requirePermissionForTarget도 이걸 상속.
  return effectiveScope({ overrides, roleRules }, allowedScopes(resource));
}

/**
 * 단건 액션 target 점검(목록 아님). all→허용, team→target.teamId가 actor.teamId와 일치, own→target.ownerUserId===userId.
 * assigned/null/누락 target → fail-closed 거부(D13·§9). 무소속 team-scope actor는 target.teamId가 비-null이어도
 * actor.teamId가 null이라 거부된다.
 */
export async function requirePermissionForTarget(
  userId: string, resource: string, action: Action,
  target: { teamId?: string | null; ownerUserId?: string | null },
): Promise<void> {
  const scope = await getEffectiveScope(userId, resource, action);
  if (scope === "all") return;
  if (scope === "own") {
    if (target.ownerUserId != null && target.ownerUserId === userId) return;
    throw new ForbiddenError(`${permissionKey(resource, action)} 권한이 없습니다.`);
  }
  if (scope === "team") {
    if (target.teamId == null) throw new ForbiddenError(`${permissionKey(resource, action)} 권한이 없습니다.`);
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { teamId: true } });
    if (me?.teamId != null && me.teamId === target.teamId) return;
    throw new ForbiddenError(`${permissionKey(resource, action)} 권한이 없습니다.`);
  }
  throw new ForbiddenError(`${permissionKey(resource, action)} 권한이 없습니다.`); // null/assigned
}

/** UI 메뉴/버튼용 허용 키 목록. OWNER는 전체, 그 외는 결정 함수로 평가. */
export async function getPermissionSummary(userId: string): Promise<PermissionSummary> {
  const now = new Date();
  const ctx = await loadUserContext(userId, now);
  if (!ctx) return { keys: [], isOwner: false, isAdmin: false };
  // D17 하드 게이트: must-change면 빈 summary·isOwner/isAdmin=false(fail-closed). UI useCan(...)도 전부 false → 메뉴/버튼 숨김.
  if (ctx.mustChangePassword) return { keys: [], isOwner: false, isAdmin: false };

  const permissions = await prisma.permission.findMany({
    select: { id: true, resource: true, action: true },
  });

  if (ctx.isOwner) {
    return { keys: permissions.map((p) => permissionKey(p.resource, p.action)), isOwner: true, isAdmin: true };
  }

  const [overrides, roleRules] = await Promise.all([
    prisma.userPermissionOverride.findMany({
      where: { userId },
      select: { permissionId: true, effect: true, scope: true, startsAt: true, endsAt: true },
    }),
    ctx.roleIds.length
      ? prisma.rolePermission.findMany({
          where: { roleId: { in: ctx.roleIds } },
          select: { permissionId: true, effect: true, scope: true },
        })
      : Promise.resolve([]),
  ]);

  const keys: string[] = [];
  for (const p of permissions) {
    const ovr = overrides
      .filter((o) => o.permissionId === p.id && withinValidity(o.startsAt, o.endsAt, now))
      .map((o) => ({ effect: o.effect, scope: o.scope as Scope }));
    const roles = roleRules
      .filter((r) => r.permissionId === p.id)
      .map((r) => ({ effect: r.effect, scope: r.scope as Scope }));
    // D5: 메뉴/useCan은 any enforceable scope면 노출(team/own grant도 메뉴는 보임). 실제 데이터 범위는 scoped 엔드포인트가 강제.
    // F-A: allowedScopes(p.resource)로 clamp — 비-scopeable resource(admin.*/workflows.* 등)는 ["all"]이라
    // team/own override가 메뉴 키를 만들지 못한다. 서버 페이지가 summary 키를 가드로 쓰고 직접 데이터를 읽어도(task-03/06 page.tsx)
    // 비-scopeable resource의 team/own override로는 노출되지 않는다(이 clamp가 없으면 page-layer 데이터 누수, F-A high).
    if (effectiveScope({ overrides: ovr, roleRules: roles }, allowedScopes(p.resource)) !== null) {
      keys.push(permissionKey(p.resource, p.action));
    }
  }
  // 여기 도달하면 ACTIVE·must-change=false인 비-OWNER. ADMIN systemRole이면 isAdmin=true(coarse).
  return { keys, isOwner: false, isAdmin: ctx.isAdmin };
}
