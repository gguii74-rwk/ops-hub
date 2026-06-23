# task-02 — scope 엔진(getEffectiveScope/requirePermissionForTarget) + summary any-scope

**목적:** target-aware scope 해석 함수를 **추가**한다. `hasPermission`/`requirePermission`/`computeDecision`는 **무변경**(scope=all만 허가). `getPermissionSummary`만 any-scope(메뉴 노출 ≠ 데이터 범위, D5).

## Files
- Create: `src/kernel/access/scope.ts` (순수 resolver + `EnforceableScope`/`SCOPE_RANK` + `SCOPEABLE_RESOURCES`/`allowedScopes`)
- Modify: `src/kernel/access/index.ts` (`getEffectiveScope`/`requirePermissionForTarget` 추가, `getPermissionSummary` 루프 any-scope)
- Create: `tests/kernel/access/scope-resolver.test.ts` (순수 resolver 우선순위·assigned 비가림)
- Create: `tests/kernel/access/effective-scope.test.ts` (prisma-mock getEffectiveScope/requirePermissionForTarget)
- Create: `tests/kernel/access/summary-any-scope.test.ts` (F2 보안 negative: summary any-scope vs requirePermission all-scope 유지)

## Prep
- 엔트리포인트 §Shared Contracts "scope 엔진 타입·시그니처", "getPermissionSummary 계약 변경", "PD2".
- 기존 `src/kernel/access/{index.ts,decision.ts}` 구조. mock 패턴: `tests/kernel/access/must-change-gate.test.ts`.

## Deps
01 (requirePermissionForTarget가 `User.teamId`를 읽는다).

## Steps

### 1. scope.ts — 순수 resolver(실패 테스트 먼저)

`tests/kernel/access/scope-resolver.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { effectiveScope, allowedScopes, SCOPE_RANK } from "@/kernel/access/scope";
import type { PermissionRule } from "@/kernel/access/decision";

const allow = (scope: PermissionRule["scope"]): PermissionRule => ({ effect: "ALLOW", scope });
const deny = (scope: PermissionRule["scope"]): PermissionRule => ({ effect: "DENY", scope });

describe("effectiveScope (computeDecision 우선순위의 scope 일반화)", () => {
  it("override DENY → null(scope 무관 거부)", () => {
    expect(effectiveScope({ overrides: [deny("all"), allow("all")], roleRules: [allow("all")] })).toBeNull();
  });
  it("override ALLOW가 role DENY를 이긴다(override 티어 우선)", () => {
    expect(effectiveScope({ overrides: [allow("team")], roleRules: [deny("all")] })).toBe("team");
  });
  it("role DENY가 role ALLOW를 이긴다", () => {
    expect(effectiveScope({ overrides: [], roleRules: [deny("all"), allow("team")] })).toBeNull();
  });
  it("ALLOW 중 가장 넓은 enforceable scope를 고른다(all>team>own)", () => {
    expect(effectiveScope({ overrides: [], roleRules: [allow("own"), allow("team")] })).toBe("team");
    expect(effectiveScope({ overrides: [], roleRules: [allow("team"), allow("all")] })).toBe("all");
  });
  // F1 — assigned는 미해석이라 ALLOW 후보에서 제외돼 더 좁은 유효 grant를 가리지 않는다.
  it("assigned는 own/team을 가리지 않는다", () => {
    expect(effectiveScope({ overrides: [], roleRules: [allow("assigned"), allow("own")] })).toBe("own");
    expect(effectiveScope({ overrides: [], roleRules: [allow("assigned"), allow("team")] })).toBe("team");
  });
  it("assigned 단독은 null(미허가, fail-closed)", () => {
    expect(effectiveScope({ overrides: [], roleRules: [allow("assigned")] })).toBeNull();
  });
  it("아무것도 없으면 null(fail-closed)", () => {
    expect(effectiveScope({ overrides: [], roleRules: [] })).toBeNull();
  });
});

describe("allowedScopes (PD2 — scopeable resource)", () => {
  it("leave.approval만 team을 연다", () => {
    expect(allowedScopes("leave.approval")).toEqual(["all", "team"]);
  });
  it("그 외는 all-only(F5 — 비-scope-aware 소비처 보호)", () => {
    expect(allowedScopes("calendar.work")).toEqual(["all"]);
    expect(allowedScopes("calendar.leave")).toEqual(["all"]);
    expect(allowedScopes("workflows.billing")).toEqual(["all"]);
    expect(allowedScopes("admin.users")).toEqual(["all"]);
  });
  it("SCOPE_RANK은 all>team>own", () => {
    expect(SCOPE_RANK.all).toBeGreaterThan(SCOPE_RANK.team);
    expect(SCOPE_RANK.team).toBeGreaterThan(SCOPE_RANK.own);
  });
});
```
실행: `npm test -- scope-resolver` → **FAIL**(scope.ts 미존재).

`src/kernel/access/scope.ts`:
```ts
import type { PermissionRule } from "@/kernel/access/decision";

export type EnforceableScope = "own" | "team" | "all"; // assigned 제외(D13 — 미해석)
export const SCOPE_RANK: Record<EnforceableScope, number> = { all: 3, team: 2, own: 1 };

// ALLOW 중 가장 넓은 enforceable scope. assigned는 후보에서 제외(F1: 미해석 scope가 좁은 유효 grant 가림 방지).
function widestEnforceable(rules: PermissionRule[]): EnforceableScope | null {
  let best: EnforceableScope | null = null;
  for (const r of rules) {
    if (r.effect !== "ALLOW") continue;
    if (r.scope === "assigned") continue;
    const s = r.scope as EnforceableScope;
    if (best === null || SCOPE_RANK[s] > SCOPE_RANK[best]) best = s;
  }
  return best;
}

// computeDecision 우선순위의 scope 일반화(OWNER/게이트는 index.ts가 prisma 컨텍스트로 처리).
// override DENY → null / override ALLOW(enforceable) → 최광 / role DENY → null / role ALLOW(enforceable) → 최광 / else null.
export function effectiveScope(input: { overrides: PermissionRule[]; roleRules: PermissionRule[] }): EnforceableScope | null {
  if (input.overrides.some((r) => r.effect === "DENY")) return null;
  const ovrAllow = widestEnforceable(input.overrides);
  if (ovrAllow) return ovrAllow;
  if (input.roleRules.some((r) => r.effect === "DENY")) return null;
  const roleAllow = widestEnforceable(input.roleRules);
  if (roleAllow) return roleAllow;
  return null;
}

// PD2 — 편집기·부트스트랩·업그레이드 마이그레이션 공유 SSOT. 본 증분에서 scope-aware 소비처가 있는 resource만 team/own을 연다.
export const SCOPEABLE_RESOURCES: Record<string, EnforceableScope[]> = {
  "leave.approval": ["all", "team"],
};
export function allowedScopes(resource: string): EnforceableScope[] {
  return SCOPEABLE_RESOURCES[resource] ?? ["all"];
}
```
실행: `npm test -- scope-resolver` → **PASS**.

### 2. index.ts — getEffectiveScope/requirePermissionForTarget 추가

`src/kernel/access/index.ts` 상단 import에 추가:
```ts
import { effectiveScope, type EnforceableScope } from "@/kernel/access/scope";
```
그리고 `export * from "@/kernel/access/catalog";` 아래에 re-export 추가:
```ts
export * from "@/kernel/access/scope";
```

`requirePermission` 함수 정의 **아래**(getPermissionSummary 위)에 두 함수 추가:
```ts
/**
 * 허가된 가장 넓은 enforceable scope(all>team>own) 또는 null. computeDecision 우선순위의 일반화.
 * OWNER→all, must-change·비활성→null(fail-closed). hasPermission/requirePermission 계약과 별개의 추가 함수.
 */
export async function getEffectiveScope(
  userId: string, resource: string, action: Action,
): Promise<EnforceableScope | null> {
  const now = new Date();
  const ctx = await loadUserContext(userId, now);
  if (!ctx) return null;
  if (ctx.mustChangePassword) return null; // D17 하드 게이트
  if (ctx.isOwner) return "all";

  const permission = await prisma.permission.findUnique({
    where: { resource_action: { resource, action } },
    select: { id: true },
  });
  if (!permission) return null;

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

  return effectiveScope({ overrides, roleRules });
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
```

### 3. getPermissionSummary — any-scope(D5)

`getPermissionSummary`의 비-OWNER 루프에서 `computeDecision(...)` 판정을 `effectiveScope(...) !== null`로 바꾼다(메뉴 노출 = 어떤 enforceable scope로든 허가). **이 함수만** 바꾼다.

기존:
```ts
    if (computeDecision({ isOwner: false, overrides: ovr, roleRules: roles })) {
      keys.push(permissionKey(p.resource, p.action));
    }
```
변경:
```ts
    // D5: 메뉴/useCan은 any enforceable scope면 노출(team/own grant도 메뉴는 보임). 실제 데이터 범위는 scoped 엔드포인트가 강제.
    if (effectiveScope({ overrides: ovr, roleRules: roles }) !== null) {
      keys.push(permissionKey(p.resource, p.action));
    }
```
(`computeDecision` import는 `hasPermission`이 계속 쓰므로 유지.)

### 4. prisma-mock 테스트 — getEffectiveScope/requirePermissionForTarget

`tests/kernel/access/effective-scope.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    permission: { findUnique: vi.fn() },
    userPermissionOverride: { findMany: vi.fn() },
    rolePermission: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { getEffectiveScope, requirePermissionForTarget, ForbiddenError } from "@/kernel/access";

// user.findUnique는 loadUserContext(systemRole/status/mustChangePassword/roleAssignments)와 teamId 조회를 겸한다 → 합본 반환.
function mockUser(over: Record<string, unknown> = {}) {
  h.db.user.findUnique.mockResolvedValue({
    systemRole: "MEMBER", status: "ACTIVE", mustChangePassword: false,
    roleAssignments: [{ roleId: "r1", startsAt: null, endsAt: null }],
    teamId: "teamA", ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.db.permission.findUnique.mockResolvedValue({ id: "p1" });
  h.db.userPermissionOverride.findMany.mockResolvedValue([]);
  h.db.rolePermission.findMany.mockResolvedValue([]);
});

describe("getEffectiveScope", () => {
  it("OWNER → all", async () => {
    mockUser({ systemRole: "OWNER", roleAssignments: [] });
    expect(await getEffectiveScope("u1", "leave.approval", "view")).toBe("all");
  });
  it("role ALLOW team → team", async () => {
    mockUser();
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "team" }]);
    expect(await getEffectiveScope("u1", "leave.approval", "view")).toBe("team");
  });
  it("권한 미존재 → null", async () => {
    mockUser();
    h.db.permission.findUnique.mockResolvedValue(null);
    expect(await getEffectiveScope("u1", "leave.approval", "view")).toBeNull();
  });
  it("must-change → null", async () => {
    mockUser({ mustChangePassword: true });
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "all" }]);
    expect(await getEffectiveScope("u1", "leave.approval", "view")).toBeNull();
  });
});

describe("requirePermissionForTarget", () => {
  it("team scope + 같은 팀 target → 허용", async () => {
    mockUser({ teamId: "teamA" });
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "team" }]);
    await expect(requirePermissionForTarget("u1", "leave.approval", "approve", { teamId: "teamA" })).resolves.toBeUndefined();
  });
  it("team scope + 타 팀 target → 거부(F3/보안)", async () => {
    mockUser({ teamId: "teamA" });
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "team" }]);
    await expect(requirePermissionForTarget("u1", "leave.approval", "approve", { teamId: "teamB" })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("team scope + 무소속 actor(teamId null) → 거부(F9)", async () => {
    mockUser({ teamId: null });
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "team" }]);
    await expect(requirePermissionForTarget("u1", "leave.approval", "approve", { teamId: "teamA" })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("all scope → target 무관 허용", async () => {
    mockUser();
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "all" }]);
    await expect(requirePermissionForTarget("u1", "leave.approval", "approve", { teamId: null })).resolves.toBeUndefined();
  });
  it("미허가(null scope) → 거부", async () => {
    mockUser();
    await expect(requirePermissionForTarget("u1", "leave.approval", "approve", { teamId: "teamA" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

### 5. F2 보안 negative — summary any-scope vs requirePermission all-scope

`tests/kernel/access/summary-any-scope.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    permission: { findUnique: vi.fn(), findMany: vi.fn() },
    userPermissionOverride: { findMany: vi.fn() },
    rolePermission: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { getPermissionSummary, hasPermission, requirePermission, ForbiddenError } from "@/kernel/access";

beforeEach(() => {
  vi.clearAllMocks();
  h.db.user.findUnique.mockResolvedValue({ systemRole: "MEMBER", status: "ACTIVE", mustChangePassword: false, roleAssignments: [{ roleId: "r1", startsAt: null, endsAt: null }] });
  h.db.permission.findMany.mockResolvedValue([{ id: "p1", resource: "leave.approval", action: "view" }]);
  h.db.permission.findUnique.mockResolvedValue({ id: "p1" });
  h.db.userPermissionOverride.findMany.mockResolvedValue([]);
  h.db.rolePermission.findMany.mockResolvedValue([{ permissionId: "p1", effect: "ALLOW", scope: "team" }]);
});

describe("D5/F2 — 메뉴 노출 ≠ 데이터 범위", () => {
  it("team-scope만 가진 사용자: getPermissionSummary는 키 노출(메뉴 보임)", async () => {
    const summary = await getPermissionSummary("u1");
    expect(summary.keys).toContain("leave.approval:view");
  });
  it("team-scope만 가진 사용자: hasPermission/requirePermission은 거부 유지(전역 상승 차단)", async () => {
    expect(await hasPermission("u1", "leave.approval", "view")).toBe(false); // scope=all 아님
    await expect(requirePermission("u1", "leave.approval", "view")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

### 6. 전체 테스트 + 커밋
`npm test -- scope` 및 access 스위트 통과 후 커밋.

## Acceptance Criteria
- `npm test -- scope-resolver effective-scope summary-any-scope` → 전부 PASS.
- `npm test -- decision must-change-gate` → 기존 access 테스트 회귀 없음(computeDecision/hasPermission/requirePermission 무변경 확인).
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 errors (boundaries 포함).

## Cautions
- **Don't** `computeDecision`·`hasPermission`·`requirePermission` 시그니처/의미를 바꾼다. Reason: 공유 커널 서버 authz 가드. any-scope로 새면 team/own grant가 unscoped allow가 된다(F2, D4 자기모순). any-scope는 `getPermissionSummary`만.
- **Don't** `assigned`를 SCOPE_RANK/widestEnforceable에 넣는다. Reason: 미해석 scope가 좁은 유효 grant를 가린다(F1).
- **Don't** requirePermissionForTarget에서 actor.teamId null일 때 team 매칭을 통과시킨다. Reason: `null === null`이 무소속 버킷 전체를 매칭(F9). target.teamId null 가드 + me.teamId null 가드 둘 다 필요.
