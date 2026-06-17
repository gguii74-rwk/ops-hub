# Task 04 — 권한 엔진 (deny 우선 · fail-closed) + requirePermission

목적: ADR-0002/spec의 권한 우선순위(OWNER → override DENY → override ALLOW → role DENY → role ALLOW → 기본 거부)를 **순수 함수로 TDD**하고, 그 위에 Prisma 기반 `hasPermission`/`requirePermission`/`getPermissionSummary`를 얹는다. UI와 API가 같은 키를 검사하게 만드는 서버 측 진실원.

## Files

- Create: `src/kernel/access/catalog.ts`
- Create: `src/kernel/access/decision.ts`
- Create: `src/kernel/access/index.ts`
- Create: `tests/kernel/access/decision.test.ts`

## Prep

- §Shared Contracts **SC-5**(접근 제어 시그니처), **SC-9**(카탈로그·역할·nav 키), **SC-8**(prisma).
- [access-control.md](../../architecture/access-control.md) "Deny 우선순위", "초기 권한 매트릭스 초안".

## Deps

03(prisma client·생성 타입).

## Steps

### 1. [TDD] 우선순위 테스트 먼저 — `tests/kernel/access/decision.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { computeDecision } from "@/kernel/access/decision";
import type { PermissionRule } from "@/kernel/access/decision";

const allow: PermissionRule = { effect: "ALLOW", scope: "all" };
const deny: PermissionRule = { effect: "DENY", scope: "all" };

describe("computeDecision (deny-priority, fail-closed)", () => {
  it("OWNER allows regardless of any rule", () => {
    expect(computeDecision({ isOwner: true, overrides: [deny], roleRules: [deny] })).toBe(true);
  });

  it("override DENY beats override ALLOW and any role rule", () => {
    expect(computeDecision({ isOwner: false, overrides: [deny, allow], roleRules: [allow] })).toBe(false);
  });

  it("override ALLOW beats role DENY", () => {
    expect(computeDecision({ isOwner: false, overrides: [allow], roleRules: [deny] })).toBe(true);
  });

  it("role DENY beats role ALLOW", () => {
    expect(computeDecision({ isOwner: false, overrides: [], roleRules: [deny, allow] })).toBe(false);
  });

  it("role ALLOW allows when no denies", () => {
    expect(computeDecision({ isOwner: false, overrides: [], roleRules: [allow] })).toBe(true);
  });

  it("treats non-all-scope ALLOW as no global grant (fail-closed, no escalation)", () => {
    const teamAllow: PermissionRule = { effect: "ALLOW", scope: "team" };
    expect(computeDecision({ isOwner: false, overrides: [], roleRules: [teamAllow] })).toBe(false);
    expect(computeDecision({ isOwner: false, overrides: [teamAllow], roleRules: [] })).toBe(false);
  });

  it("defaults to deny when nothing matches (fail-closed)", () => {
    expect(computeDecision({ isOwner: false, overrides: [], roleRules: [] })).toBe(false);
  });
});
```

실행 — 구현 전이라 FAIL(모듈 없음) 확인:

```bash
npm test
```

### 2. [GREEN] 순수 결정 함수 — `src/kernel/access/decision.ts`

```ts
export type Action =
  | "view" | "create" | "update" | "delete" | "approve"
  | "generate" | "review" | "send" | "configure" | "export" | "impersonate";

export type Scope = "own" | "team" | "assigned" | "all";

export interface PermissionRule {
  effect: "ALLOW" | "DENY";
  scope: Scope;
}

export interface DecisionInput {
  isOwner: boolean;
  overrides: PermissionRule[];
  roleRules: PermissionRule[];
}

/**
 * 권한 결정(컨텍스트 없는 전역 검사). 우선순위(ADR-0002):
 * OWNER → override DENY → override ALLOW → role DENY → role ALLOW → 기본 거부(fail-closed).
 * ALLOW는 scope="all"만 허가로 인정한다. own/team/assigned는 target 컨텍스트 없이 평가 불가 →
 * 전역 검사에선 허가로 치지 않는다(스코프 ALLOW의 전역 누수 차단). DENY는 스코프 무관 거부(보수적).
 */
export function computeDecision(input: DecisionInput): boolean {
  if (input.isOwner) return true;
  if (input.overrides.some((r) => r.effect === "DENY")) return false;
  if (input.overrides.some((r) => r.effect === "ALLOW" && r.scope === "all")) return true;
  if (input.roleRules.some((r) => r.effect === "DENY")) return false;
  if (input.roleRules.some((r) => r.effect === "ALLOW" && r.scope === "all")) return true;
  return false;
}

export function permissionKey(resource: string, action: string): string {
  return `${resource}:${action}`;
}
```

실행 — PASS 확인:

```bash
npm test
```

### 3. 카탈로그 상수 — `src/kernel/access/catalog.ts`

§SC-9 그대로 단일 정의(seed·nav가 import).

```ts
export const RESOURCES = [
  "dashboard",
  "calendar.work", "calendar.leave", "calendar.personal", "calendar.team", "calendar.admin",
  "workflows.weekly", "workflows.billing", "workflows.notification",
  "leave.request", "leave.approval", "leave.allocation",
  "admin.users", "admin.settings", "admin.audit",
  "integrations.google", "integrations.smtp", "integrations.templates",
] as const;

export const ACTIONS = [
  "view", "create", "update", "delete", "approve",
  "generate", "review", "send", "configure", "export", "impersonate",
] as const;

export const ACCESS_ROLE_KEYS = [
  "pm",
  "regular-developer",
  "contractor-developer",
  "contractor-content",
  "contractor-civil-response",
] as const;

export type AccessRoleKey = (typeof ACCESS_ROLE_KEYS)[number];

export interface NavEntry {
  key: string;
  label: string;
  href: string;
  permission: string; // "resource:action"
}

export const NAV: readonly NavEntry[] = [
  { key: "dashboard", label: "대시보드", href: "/dashboard", permission: "dashboard:view" },
  { key: "calendar", label: "캘린더", href: "/calendar", permission: "calendar.work:view" },
  { key: "workflows", label: "업무", href: "/workflows", permission: "workflows.weekly:view" },
  { key: "leave", label: "연차", href: "/leave", permission: "leave.request:view" },
  { key: "admin", label: "관리", href: "/admin", permission: "admin.users:view" },
] as const;
```

### 4. Prisma 기반 권한 평가 — `src/kernel/access/index.ts`

```ts
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
      roleAssignments: { select: { roleId: true, startsAt: true, endsAt: true } },
    },
  });
  if (!user) return null;
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
```

### 5. 검증

```bash
npm test           # decision 테스트 7개 통과
npm run typecheck  # 에러 0 (Prisma 생성 타입과 정합)
npm run lint       # 에러 0 (kernel → lib 의존만 사용)
```

### 6. 커밋

```bash
git add -A
git commit -m "Add permission engine: deny-priority decision, requirePermission, summary"
```

## Acceptance Criteria

- `tests/kernel/access/decision.test.ts` 7개 케이스 통과(특히 fail-closed·override DENY 우선·비-all 스코프 ALLOW 무허가).
- `requirePermission`이 거부 시 `ForbiddenError`를 던진다.
- `getPermissionSummary`가 OWNER엔 전체 키, 그 외엔 결정 함수 결과만 반환.
- `npm run typecheck`/`lint` 에러 0.

## Cautions

- **Don't 권한 목록을 세션·토큰에 넣지 마라. Reason:** SC-5/SC-6. summary는 항상 이 함수로 별도 조회한다(권한 변경이 즉시 반영되고 토큰이 비대해지지 않음).
- **Don't 우선순위 순서를 바꾸지 마라. Reason:** override가 role보다, DENY가 ALLOW보다 우선해야 fail-closed가 성립한다. 순서가 곧 보안이다.
- **Don't `scope`를 무시하고 ALLOW를 전역 허가로 처리하지 마라. Reason:** `own/team/assigned` 스코프 ALLOW를 컨텍스트 없이 허가로 인정하면 스코프 RBAC가 전역 권한으로 새어 에스컬레이션이 된다. 전역 검사는 `scope:"all"` ALLOW만 인정하고 나머지는 fail-closed로 둔다. 스코프 인지 평가(target 컨텍스트)는 해당 리소스가 생기는 도메인 플랜에서 API를 확장해 처리한다.
- **Don't `prisma.permission.findUnique`의 복합 unique 이름을 추측하지 마라. Reason:** `@@unique([resource, action])`의 Prisma 인자명은 `resource_action`이다. 생성 타입이 다르면 typecheck가 알려준다 — 그때 생성된 이름으로 맞춘다.
