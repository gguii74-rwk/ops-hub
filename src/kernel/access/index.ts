import { prisma } from "@/lib/prisma";
import { computeDecision, permissionKey } from "@/kernel/access/decision";
import type { Action, PermissionRule, Scope } from "@/kernel/access/decision";

export * from "@/kernel/access/decision";
export * from "@/kernel/access/catalog";

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

async function loadUserContext(userId: string, now: Date): Promise<UserContext | null> {
  const user = await prisma.user.findUnique({
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
    if (computeDecision({ isOwner: false, overrides: ovr, roleRules: roles })) {
      keys.push(permissionKey(p.resource, p.action));
    }
  }
  // 여기 도달하면 ACTIVE·must-change=false인 비-OWNER. ADMIN systemRole이면 isAdmin=true(coarse).
  return { keys, isOwner: false, isAdmin: ctx.isAdmin };
}
