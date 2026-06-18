import { prisma } from "@/lib/prisma";
import { computeDecision, permissionKey } from "@/kernel/access/decision";
import type { Action, PermissionRule, Scope } from "@/kernel/access/decision";

export * from "@/kernel/access/decision";
export * from "@/kernel/access/catalog";

export interface PermissionSummary {
  keys: string[];
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
  roleIds: string[];
}

async function loadUserContext(userId: string, now: Date): Promise<UserContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      systemRole: true,
      status: true,
      roleAssignments: { select: { roleId: true, startsAt: true, endsAt: true } },
    },
  });
  if (!user) return null;
  if (user.status !== "ACTIVE") return null;
  const roleIds = user.roleAssignments
    .filter((a) => withinValidity(a.startsAt, a.endsAt, now))
    .map((a) => a.roleId);
  return { isOwner: user.systemRole === "OWNER", roleIds };
}

export async function hasPermission(userId: string, resource: string, action: Action): Promise<boolean> {
  const now = new Date();
  const ctx = await loadUserContext(userId, now);
  if (!ctx) return false;
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
  if (!ctx) return { keys: [] };

  const permissions = await prisma.permission.findMany({
    select: { id: true, resource: true, action: true },
  });

  if (ctx.isOwner) {
    return { keys: permissions.map((p) => permissionKey(p.resource, p.action)) };
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
  return { keys };
}
