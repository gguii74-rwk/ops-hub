# task-06 — 매트릭스 편집기 + seed 부트스트랩화 + 업그레이드 마이그레이션

**목적:** 역할↔권한 매트릭스 편집기(`/admin/roles`, `admin.roles:view`/`configure`). **OWNER-only**(D7), `pm` 행 read-only, scope 옵션 제약(PD2=`leave.approval`만), 모든 셀 변경 감사. seed 3단계를 **부트스트랩-if-empty**(D9)로, 기존 설치엔 **1회 멱등 업그레이드**(D10, 위임 admin 신규 grant).

## Files
- Modify: `src/kernel/access/catalog.ts` (`RESOURCES += "admin.roles"`, `NAV` admin 자식 `admin-roles`)
- Modify: `prisma/seed-permissions.ts` (`EXTRA_PERMISSIONS += ["admin.roles","configure"]`)
- Modify: `prisma/seed-roles.ts` (위임 admin `+admin.roles:view`; `ROLE_ALLOW` 타입을 scope-tuple 인코딩으로 확장)
- Modify: `prisma/seed.ts` (step3 부트스트랩-if-empty + step3b 업그레이드-once)
- Create: `src/modules/admin/roles/repositories/index.ts`
- Create: `src/modules/admin/roles/services/index.ts`
- Create: `src/modules/admin/roles/validations/index.ts`
- Create: `src/app/api/admin/roles/matrix/route.ts` (GET)
- Create: `src/app/api/admin/roles/[roleId]/permissions/[permissionId]/route.ts` (PUT)
- Create: `src/app/(app)/admin/roles/page.tsx` + `_components/matrix-editor.tsx`
- Create: `prisma/migrate-helpers/teams-upgrade.ts` (업그레이드-once 로직 — 테스트 가능하게 추출)
- Create: `tests/modules/admin/roles/matrix-service.test.ts`, `tests/modules/admin/roles/matrix-repo.test.ts`(F-H in-tx OWNER 재확인), `tests/kernel/access/roles-catalog.test.ts`, `tests/prisma/seed-bootstrap.test.ts`, `tests/prisma/teams-upgrade.test.ts`

## Prep
- 엔트리포인트 §Shared Contracts "scope 엔진"(`allowedScopes`/`SCOPEABLE_RESOURCES`), "seed 부트스트랩화 + 업그레이드", "PD2", "감사 로그 패턴".
- task-02: `allowedScopes`. task-03: catalog 편집 선례(admin.teams). 기존 `prisma/seed.ts` step3.

## Deps
02 (allowedScopes/scope 엔진), 03 (catalog 패턴, admin.teams 선행).

## Steps

### 1. catalog/permissions/roles 추가 (실패 테스트 먼저)

`tests/kernel/access/roles-catalog.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { RESOURCES, NAV } from "@/kernel/access/catalog";

describe("admin.roles 카탈로그·nav (D11)", () => {
  it("RESOURCES에 admin.roles 포함", () => { expect(RESOURCES).toContain("admin.roles"); });
  it("NAV admin 트리에 admin-roles(/admin/roles, admin.roles:view)", () => {
    const teams = NAV.find((n) => n.key === "admin")?.children?.find((c) => c.key === "admin-roles");
    expect(teams).toMatchObject({ href: "/admin/roles", permission: "admin.roles:view" });
  });
});
```
→ **FAIL**.

`catalog.ts` `RESOURCES` admin 줄: `"admin.navigation", "admin.teams", "admin.roles",`. `NAV` admin 자식에 추가(`admin-teams` 다음):
```ts
        { key: "admin-roles", label: "권한 매트릭스", href: "/admin/roles", permission: "admin.roles:view" },
```
`seed-permissions.ts` `EXTRA_PERMISSIONS += ["admin.roles", "configure"]`.
`seed-roles.ts` 위임 admin 배열에 `"admin.roles:view"` 추가(`admin.roles:configure`는 **미부여** — OWNER 전용 D7).
→ catalog 테스트 **PASS**.

### 2. ROLE_ALLOW scope-tuple 인코딩(D9 능력 추가)

`prisma/seed-roles.ts` 타입을 확장(현 값은 전부 string=all → 무변경 동작) + **OWNER 전용 키 제외 확장 헬퍼**(F-L):
```ts
// 셀 scope 인코딩(D9): "key" = scope "all", ["key","team"] = team scope. 현 매트릭스엔 non-all 셀이 없다(PD2 —
// team-scope 승인은 "제한"=미부여, OWNER가 편집기로 leave.approval team 부여). tuple은 *능력*만 추가.
type Cell = string | [string, "own" | "team" | "all"];
export const ROLE_ALLOW: Record<string, Cell[]> = {
  // ... 기존 값 그대로(전부 string). admin 배열엔 step1에서 admin.teams:*/admin.roles:view 추가됨.
};

// OWNER systemRole 전용 — 어떤 AccessRole에도 시드 안 함(D7). pm "*" 와일드카드 확장에서도 제외(F-L: 안 그러면 pm이 god-power).
export const OWNER_ONLY_KEYS: readonly string[] = ["admin.roles:configure"];

// 한 역할의 ROLE_ALLOW 항목을 (key, scope)[] 셀로 확장. "*"=allKeys 전체(OWNER 전용 키 제외), 그 외는 명시 항목.
// 두 경로 모두 OWNER_ONLY_KEYS를 최종 제외 — fresh seed가 OWNER 전용 권한을 어떤 역할에도 주지 않음(D7 불변식).
export function expandRoleCells(wanted: Cell[], allKeys: string[]): Array<readonly [string, "own" | "team" | "all"]> {
  const base = wanted.includes("*")
    ? allKeys.map((key) => [key, "all"] as const)
    : wanted.map((c) => (Array.isArray(c) ? [c[0], c[1]] as const : [c, "all"] as const));
  return base.filter(([key]) => !OWNER_ONLY_KEYS.includes(key)); // F-L 제외
}
```
(기존 ROLE_ALLOW 배열 항목은 손대지 않는다 — 타입만 `Cell[]`로 넓히고 헬퍼만 추가.)

### 3. seed.ts — 부트스트랩-if-empty(D9) + 업그레이드-once(D10)

`prisma/seed.ts` **step 3**(역할별 deleteMany+createMany)를 교체:
```ts
  // 3. RolePermissions — 부트스트랩-if-empty(D9). 역할 행이 0개일 때만 ROLE_ALLOW로 시드.
  //    기존 행(UI 편집 포함)은 보존 — 부트스트랩 후 DB가 진실원, 코드 ROLE_ALLOW는 초기 1회 시드일 뿐.
  const existingRoleGrants = await prisma.rolePermission.count();
  if (existingRoleGrants === 0) {
    for (const role of ACCESS_ROLES) {
      const wanted = ROLE_ALLOW[role.key] ?? [];
      const roleId = roleIdByKey.get(role.key)!;
      const cells = expandRoleCells(wanted, allKeys); // "*" 확장 + OWNER_ONLY_KEYS 제외(F-L — pm도 admin.roles:configure 미부여)
      const rows = cells
        .map(([key, scope]) => { const pid = permissionIdByKey.get(key); return pid ? { roleId, permissionId: pid, effect: "ALLOW" as const, scope } : null; })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });
    }
  }

  // 3b. 업그레이드-once(D10·F4·F-K) — 트랜잭션으로 감싸 upsert+플래그 원자화. 비어있지 않은 DB의 위임-admin 신규 grant를 1회 멱등 upsert.
  await prisma.$transaction((tx) => applyTeamsPermissionUpgrade(tx, roleIdByKey, permissionIdByKey));
```
(`allKeys`는 기존 step3 위에서 선언됨 — 위치 유지. `expandRoleCells`/`ROLE_ALLOW`는 seed.ts 상단에서 `./seed-roles`로 import. step3b helper는 `import { applyTeamsPermissionUpgrade } from "./migrate-helpers/teams-upgrade";`)

`prisma/migrate-helpers/teams-upgrade.ts` — 업그레이드-once 로직(D10·F4). 플래그로 1회 + 이후 UI가 진실원(OWNER가 편집기로 제거한 grant를 재seed가 되살리지 않음):
```ts
// 클라이언트 표면 최소화(실 PrismaClient·테스트 mock 둘 다 충족).
export interface UpgradeClient {
  systemSetting: {
    findUnique(a: { where: { key: string } }): Promise<{ key: string } | null>;
    create(a: { data: { key: string; value: unknown } }): Promise<unknown>;
  };
  rolePermission: {
    upsert(a: {
      where: { roleId_permissionId_scope: { roleId: string; permissionId: string; scope: string } };
      update: Record<string, never>;
      create: { roleId: string; permissionId: string; effect: "ALLOW"; scope: string };
    }): Promise<unknown>;
  };
}

export const UPGRADE_FLAG = "migration.teams-permission-matrix.upgrade.applied";
export const UPGRADE_GRANT_KEYS = ["admin.teams:view", "admin.teams:configure", "admin.roles:view"] as const;

// 위임 admin에 신규 grant upsert(F4). 이미 적용(플래그 존재)이면 no-op. roleIdByKey/permissionIdByKey는 seed가 채운 맵.
// F-K fail-closed: 전제(위임 admin 역할 + 모든 신규 grant permission)가 하나라도 없으면 **throw**(플래그 미설정) —
// seed 순서/카탈로그 드리프트로 grant를 건너뛴 채 영구 "applied"로 마킹되는 fail-open을 막는다. 플래그는 **모든 upsert 성공 후**에만.
export async function applyTeamsPermissionUpgrade(
  db: UpgradeClient,
  roleIdByKey: Map<string, string>,
  permissionIdByKey: Map<string, string>,
): Promise<{ applied: boolean }> {
  const already = await db.systemSetting.findUnique({ where: { key: UPGRADE_FLAG } });
  if (already) return { applied: false };
  const adminRoleId = roleIdByKey.get("admin");
  if (!adminRoleId) throw new Error("teams-upgrade: 'admin' 역할 미존재(seed 순서/드리프트) — 플래그 미설정, 다음 seed에서 재시도");
  // 모든 grant permission id를 먼저 해석(하나라도 없으면 throw — upsert/플래그 전에 중단).
  const grants = UPGRADE_GRANT_KEYS.map((key) => {
    const pid = permissionIdByKey.get(key);
    if (!pid) throw new Error(`teams-upgrade: 권한 '${key}' 미존재 — 플래그 미설정, 재시도 필요`);
    return pid;
  });
  for (const pid of grants) {
    await db.rolePermission.upsert({
      where: { roleId_permissionId_scope: { roleId: adminRoleId, permissionId: pid, scope: "all" } },
      update: {},
      create: { roleId: adminRoleId, permissionId: pid, effect: "ALLOW", scope: "all" },
    });
  }
  await db.systemSetting.create({ data: { key: UPGRADE_FLAG, value: { appliedAt: "bootstrap" } } }); // 모든 upsert 성공 후에만
  return { applied: true };
}
```
(seed가 `new Date()` 대신 고정 문자열을 value로 — 결정성. **원자성**: seed.ts step 3b는 `prisma.$transaction((tx) => applyTeamsPermissionUpgrade(tx, ...))`로 감싸 upsert+플래그를 한 트랜잭션에 둔다 — 부분 적용 후 플래그 set 방지. `UpgradeClient`는 tx 클라이언트로 충족(rolePermission.upsert·systemSetting.*).)

`tests/prisma/teams-upgrade.test.ts` (F4 — 비어있지 않은 DB 업그레이드):
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyTeamsPermissionUpgrade, UPGRADE_GRANT_KEYS } from "../../prisma/migrate-helpers/teams-upgrade";

function mkDb(flagExists: boolean) {
  return {
    systemSetting: { findUnique: vi.fn(async () => (flagExists ? { key: "x" } : null)), create: vi.fn(async () => ({})) },
    rolePermission: { upsert: vi.fn(async () => ({})) },
  };
}
const roleIds = new Map([["admin", "role-admin"]]);
const permIds = new Map(UPGRADE_GRANT_KEYS.map((k, i) => [k, `perm-${i}`]));

describe("applyTeamsPermissionUpgrade (D10/F4)", () => {
  it("플래그 없으면 3개 grant upsert + 플래그 set(비어있지 않은 기존 설치)", async () => {
    const db = mkDb(false);
    const r = await applyTeamsPermissionUpgrade(db as never, roleIds, permIds);
    expect(r.applied).toBe(true);
    expect(db.rolePermission.upsert).toHaveBeenCalledTimes(3);
    expect(db.systemSetting.create).toHaveBeenCalled();
  });
  it("플래그 있으면 no-op(1회 보장 — OWNER 편집 보존)", async () => {
    const db = mkDb(true);
    const r = await applyTeamsPermissionUpgrade(db as never, roleIds, permIds);
    expect(r.applied).toBe(false);
    expect(db.rolePermission.upsert).not.toHaveBeenCalled();
  });
  it("필수 권한 누락 시 throw + 플래그 미설정(fail-closed, F-K)", async () => {
    const db = mkDb(false);
    const partialPerms = new Map([[UPGRADE_GRANT_KEYS[0], "perm-0"]]); // 1개만 존재 — 나머지 누락
    await expect(applyTeamsPermissionUpgrade(db as never, roleIds, partialPerms)).rejects.toThrow(/미존재/);
    expect(db.systemSetting.create).not.toHaveBeenCalled(); // 플래그 set 안 됨 → 다음 seed 재시도
  });
  it("admin 역할 누락 시 throw + 플래그 미설정", async () => {
    const db = mkDb(false);
    await expect(applyTeamsPermissionUpgrade(db as never, new Map(), permIds)).rejects.toThrow(/admin/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });
});
```

> **주의(F1 역전, D9):** 기존 step3의 `deleteMany`(stale ALLOW 제거)는 **제거**된다. 부트스트랩-if-empty 이후 DB가 진실원이므로 코드에서 키를 빼도 운영 권한이 안 바뀌는 게 **의도**(D9). stale 누수 우려는 편집기/감사가 대체.

`tests/prisma/seed-bootstrap.test.ts`(순수 로직 — cells 인코딩 단위검증; DB-less):
```ts
import { describe, it, expect } from "vitest";
import { ROLE_ALLOW, expandRoleCells, OWNER_ONLY_KEYS } from "../../prisma/seed-roles";

describe("ROLE_ALLOW scope-tuple 인코딩(D9)", () => {
  it("현 매트릭스는 non-all scope 셀이 없다(PD2 — team은 편집기로)", () => {
    for (const cells of Object.values(ROLE_ALLOW)) {
      for (const c of cells) {
        if (Array.isArray(c)) expect(c[1]).toBe("all");
      }
    }
  });
  it("pm은 와일드카드(*)", () => { expect(ROLE_ALLOW.pm).toContain("*"); });
  it("위임 admin에 admin.teams/admin.roles:view 포함", () => {
    expect(ROLE_ALLOW.admin).toContain("admin.teams:view");
    expect(ROLE_ALLOW.admin).toContain("admin.teams:configure");
    expect(ROLE_ALLOW.admin).toContain("admin.roles:view");
  });
});

describe("expandRoleCells — OWNER 전용 키 제외(F-L)", () => {
  // admin.roles:configure를 포함한 전체 키 집합으로 와일드카드를 확장해도 OWNER 전용 키는 빠져야 한다.
  const allKeys = ["leave.approval:view", "leave.approval:approve", "admin.teams:configure", "admin.roles:view", "admin.roles:configure"];
  it("pm '*' 확장이 admin.roles:configure를 부여하지 않는다(D7 불변식)", () => {
    const cells = expandRoleCells(["*"], allKeys);
    expect(cells.map(([k]) => k)).not.toContain("admin.roles:configure");
    expect(cells.map(([k]) => k)).toContain("admin.teams:configure"); // 다른 키는 정상 포함
  });
  it("명시 항목 경로도 OWNER 전용 키를 제외", () => {
    expect(expandRoleCells(["admin.roles:configure", "admin.roles:view"], allKeys).map(([k]) => k)).toEqual(["admin.roles:view"]);
  });
  it("어떤 ROLE_ALLOW 역할도 확장 후 OWNER 전용 키를 받지 않는다", () => {
    for (const cells of Object.values(ROLE_ALLOW)) {
      const expanded = expandRoleCells(cells, allKeys).map(([k]) => k);
      for (const owned of OWNER_ONLY_KEYS) expect(expanded).not.toContain(owned);
    }
  });
});
```

### 4. validations

`src/modules/admin/roles/validations/index.ts`:
```ts
import { z } from "zod";
export const setCellSchema = z.object({
  effect: z.enum(["none", "ALLOW", "DENY"]),
  scope: z.enum(["own", "team", "all"]).default("all"),
});
export type SetCellInput = z.infer<typeof setCellSchema>;
```

### 5. repositories — matrix 조회 + 셀 치환(트랜잭션 + 감사)

`src/modules/admin/roles/repositories/index.ts`:
```ts
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

// scope가 unique 키의 일부라 scope 변경 = 행 치환. 같은 (role,permission)의 모든 scope 행을 지우고 none이 아니면 1행 생성.
// F-H: OWNER 권위 점검을 **이 쓰기 트랜잭션 내부에서** actor를 잠그고 재확인한다. 서비스의 assertOwner는 빠른 pre-check일 뿐,
// precheck 이후 actor가 강등(OWNER→ADMIN)·비활성·must-change로 바뀌면 stale 권한으로 매트릭스(최고위험 op)를 바꿀 수 있다.
export async function setCell(
  roleId: string, permissionId: string,
  effect: "none" | "ALLOW" | "DENY", scope: string, actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
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
```

### 6. services — OWNER-only + pm read-only + scope 제약(D6·D7·D8/PD2)

`src/modules/admin/roles/services/index.ts`:
```ts
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
```

### 7. API routes

`src/app/api/admin/roles/matrix/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission, ForbiddenError } from "@/kernel/access";
import { getRoleMatrix } from "@/modules/admin/roles/services";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    await requirePermission(session.user.id, "admin.roles", "view");
    const matrix = await getRoleMatrix();
    return NextResponse.json(matrix, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
```

`src/app/api/admin/roles/[roleId]/permissions/[permissionId]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/kernel/access";
import { setRoleCell } from "@/modules/admin/roles/services";
import { setCellSchema } from "@/modules/admin/roles/validations";

export async function PUT(req: Request, { params }: { params: Promise<{ roleId: string; permissionId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { roleId, permissionId } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = setCellSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await setRoleCell(session.user.id, roleId, permissionId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
```

### 8. UI — page + matrix-editor

`src/app/(app)/admin/roles/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { getRoleMatrix } from "@/modules/admin/roles/services";
import { allowedScopes } from "@/kernel/access";
import { MatrixEditor } from "./_components/matrix-editor";

export default async function AdminRolesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const summary = await getPermissionSummary(session.user.id);
  const canView = summary.isOwner || summary.keys.includes("admin.roles:view");
  if (!canView) redirect("/dashboard");
  const canConfigure = summary.isOwner; // configure는 OWNER 전용(D7) — 위임 admin은 read-only

  const matrix = await getRoleMatrix();
  // 각 permission의 scopeable 옵션을 서버에서 계산해 내려준다(PD2).
  const scopeOptions: Record<string, string[]> = {};
  for (const p of matrix.permissions) scopeOptions[`${p.resource}:${p.action}`] = allowedScopes(p.resource);
  return <MatrixEditor matrix={matrix} scopeOptions={scopeOptions} canConfigure={canConfigure} />;
}
```

`src/app/(app)/admin/roles/_components/matrix-editor.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Matrix {
  roles: Array<{ id: string; key: string; name: string }>;
  permissions: Array<{ id: string; resource: string; action: string }>;
  rules: Array<{ roleId: string; permissionId: string; effect: "ALLOW" | "DENY"; scope: string }>;
}

export function MatrixEditor({ matrix, scopeOptions, canConfigure }: { matrix: Matrix; scopeOptions: Record<string, string[]>; canConfigure: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const ruleKey = (r: string, p: string) => `${r}:${p}`;
  const byCell = new Map(matrix.rules.map((x) => [ruleKey(x.roleId, x.permissionId), x]));

  async function setCell(roleId: string, permissionId: string, effect: string, scope: string) {
    setErr(null);
    const res = await fetch(`/api/admin/roles/${roleId}/permissions/${permissionId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effect, scope }),
    });
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? "오류"); return; }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">권한 매트릭스</h1>
      {!canConfigure && <p className="text-sm text-muted-foreground">읽기 전용 — 편집은 OWNER만 가능합니다.</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr><th className="sticky left-0 bg-background p-2 text-left">권한</th>
              {matrix.roles.map((r) => <th key={r.id} className="p-2">{r.name}</th>)}</tr>
          </thead>
          <tbody>
            {matrix.permissions.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="sticky left-0 bg-background p-2 font-mono">{p.resource}:{p.action}</td>
                {matrix.roles.map((role) => {
                  const cell = byCell.get(ruleKey(role.id, p.id));
                  const effect = cell?.effect ?? "none";
                  const scope = cell?.scope ?? "all";
                  const locked = !canConfigure || role.key === "pm";
                  const scopes = scopeOptions[`${p.resource}:${p.action}`] ?? ["all"];
                  return (
                    <td key={role.id} className="p-1 text-center">
                      {locked
                        ? <span>{effect === "none" ? "·" : `${effect}/${scope}`}</span>
                        : (
                          <div className="flex gap-1 justify-center">
                            <select value={effect} onChange={(e) => setCell(role.id, p.id, e.target.value, e.target.value === "ALLOW" ? scope : "all")}>
                              <option value="none">·</option><option value="ALLOW">ALLOW</option><option value="DENY">DENY</option>
                            </select>
                            {effect === "ALLOW" && scopes.length > 1 && (
                              <select value={scope} onChange={(e) => setCell(role.id, p.id, "ALLOW", e.target.value)}>
                                {scopes.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                            )}
                          </div>
                        )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

### 9. 매트릭스 서비스 테스트(OWNER-only·pm·scope·감사)

`tests/modules/admin/roles/matrix-service.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    accessRole: { findUnique: vi.fn() },
    permission: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
const access = vi.hoisted(() => ({ requirePermission: vi.fn(), setCell: vi.fn() }));
vi.mock("@/kernel/access", async (orig) => ({ ...(await orig()), requirePermission: access.requirePermission }));
vi.mock("@/modules/admin/roles/repositories", async (orig) => ({ ...(await orig()), setCell: access.setCell }));

import { setRoleCell } from "@/modules/admin/roles/services";
import { ForbiddenError } from "@/kernel/access";

beforeEach(() => {
  vi.clearAllMocks();
  access.requirePermission.mockResolvedValue(undefined);
  h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: false });
  h.db.accessRole.findUnique.mockResolvedValue({ key: "regular-developer" });
  h.db.permission.findUnique.mockResolvedValue({ resource: "leave.approval", action: "view" });
});

describe("setRoleCell 가드", () => {
  it("비-OWNER는 거부(D7 방어선)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "ADMIN", status: "ACTIVE", mustChangePassword: false });
    await expect(setRoleCell("u1", "r1", "p1", { effect: "ALLOW", scope: "team" })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("pm 행은 read-only", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "pm" });
    await expect(setRoleCell("owner", "rpm", "p1", { effect: "ALLOW", scope: "all" })).rejects.toThrow(/pm/);
  });
  it("leave.approval team ALLOW 허용", async () => {
    await setRoleCell("owner", "r1", "p1", { effect: "ALLOW", scope: "team" });
    expect(access.setCell).toHaveBeenCalledWith("r1", "p1", "ALLOW", "team", "owner");
  });
  it("비-scopeable resource의 team scope 거부(F5/PD2)", async () => {
    h.db.permission.findUnique.mockResolvedValue({ resource: "calendar.work", action: "view" });
    await expect(setRoleCell("owner", "r1", "p1", { effect: "ALLOW", scope: "team" })).rejects.toThrow(/지원하지 않/);
  });
  it("admin.roles:configure는 부여 불가(anti-escalation)", async () => {
    h.db.permission.findUnique.mockResolvedValue({ resource: "admin.roles", action: "configure" });
    await expect(setRoleCell("owner", "r1", "p1", { effect: "ALLOW", scope: "all" })).rejects.toThrow(/OWNER 전용/);
  });
  it("DENY는 scope를 all로 정규화", async () => {
    await setRoleCell("owner", "r1", "p1", { effect: "DENY", scope: "team" });
    expect(access.setCell).toHaveBeenCalledWith("r1", "p1", "DENY", "all", "owner");
  });
});
```

**F-H — `setCell` in-tx OWNER 재확인**(repository, setCell을 mock하지 않는 별도 파일) `tests/modules/admin/roles/matrix-repo.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn() },
    rolePermission: { findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return { tx, db: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) } };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { setCell } from "@/modules/admin/roles/repositories";
import { ForbiddenError } from "@/kernel/access";

beforeEach(() => {
  vi.clearAllMocks();
  h.tx.$queryRaw.mockResolvedValue([]);
  h.tx.rolePermission.findFirst.mockResolvedValue(null);
  h.tx.rolePermission.deleteMany.mockResolvedValue({ count: 0 });
});

describe("setCell in-tx OWNER 재확인(F-H)", () => {
  it("tx 내부에서 actor가 더 이상 OWNER가 아니면 거부 + 셀/감사 미기록", async () => {
    h.tx.user.findUnique.mockResolvedValue({ systemRole: "ADMIN", status: "ACTIVE", mustChangePassword: false }); // precheck 이후 강등
    await expect(setCell("r1", "p1", "ALLOW", "all", "actor")).rejects.toBeInstanceOf(ForbiddenError);
    expect(h.tx.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(h.tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("OWNER면 정상 치환 + 감사", async () => {
    h.tx.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: false });
    await setCell("r1", "p1", "ALLOW", "all", "actor");
    expect(h.tx.rolePermission.create).toHaveBeenCalled();
    expect(h.tx.auditLog.create).toHaveBeenCalled();
  });
});
```

### 10. 통과 + 커밋
`npm test -- matrix-service matrix-repo roles-catalog seed-bootstrap teams-upgrade` 통과.

## Acceptance Criteria
- `npm test -- matrix-service matrix-repo roles-catalog seed-bootstrap teams-upgrade` → PASS (F4 + F-H 포함).
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 errors (admin/roles 경계).
- `npm run prisma:validate` → valid.
- 수동: OWNER `/admin/roles` → 셀 ALLOW/DENY/none + leave.approval team select 동작, pm 행 잠김; 위임 admin은 read-only(PUT 403).

## Cautions
- **Don't** `admin.roles:configure`를 시드/매트릭스로 어떤 역할에 부여 — **pm `*` 와일드카드 확장 포함**(F-L). Reason: OWNER systemRole 전용(D7). pm `*`가 allKeys로 확장되면 admin.roles:configure까지 부여돼 god-power 위임(escalation)이 fresh seed에 생긴다. `expandRoleCells`가 `OWNER_ONLY_KEYS`를 제외 + assertOwner + anti-escalation + setCell in-tx OWNER + smoke(어떤 역할도 미보유) 다중 가드.
- **Don't** non-scopeable resource에 team/own을 허용. Reason: `/api/calendar/feed` 등은 all-scope `requirePermission` → 메뉴 노출↔API 403(F5/PD2). `allowedScopes` 강제.
- **Don't** step3 `deleteMany`를 유지하거나 부트스트랩을 무조건 실행. Reason: 비어있지 않은 DB(UI 편집)를 코드값으로 덮어쓴다(D9 정면 위배). count===0 가드 필수.
- **Don't** 업그레이드 블록을 플래그 없이 매 seed 실행. Reason: OWNER가 편집기로 제거한 grant를 재seed가 되살린다(UI 진실원 위배). 플래그로 1회.
- **Don't** 셀 변경 감사를 누락. Reason: 권한 재정의는 최상위 행위(D7) — before/after 필수.
- **Don't** OWNER 권위 점검을 setCell 쓰기 트랜잭션 **밖**에서만 한다. Reason: precheck(assertOwner) 이후 강등·비활성·must-change로 바뀐 actor가 stale 권한으로 매트릭스(god-power)를 바꿀 수 있다(F-H stale-authz). 권위 점검은 tx 내부에서 actor 행 `FOR UPDATE` 잠금 + 재확인.
