# Task 02 — 묶음 백엔드 (assertCellAllowed 추출·setRoleCellsBulk·route·validation)

**Purpose:** 단건 `setRoleCell`의 per-permission 가드를 순수 함수 `assertCellAllowed`로 추출(동작 불변)하고, 그것을 재사용하는 묶음 서비스 `setRoleCellsBulk` + 검증 스키마 + 라우트를 추가한다.

## Files

- Modify: `src/modules/admin/roles/services/index.ts` — `assertRoleEditable`·`assertCellAllowed` 추출, `setRoleCell` 리팩터(동작 불변), `BulkResult`·`setRoleCellsBulk` 추가.
- Modify: `src/modules/admin/roles/validations/index.ts` — `bulkSetSchema`·`BulkSetInput` 추가.
- Create: `src/app/api/admin/roles/[roleId]/permissions/bulk/route.ts` — 묶음 PUT 라우트.
- Test: `tests/modules/admin/roles/matrix-bulk.test.ts` — 신규(묶음 서비스 가드).

## Prep

- Spec §D6, §D7, §D8.
- §Shared Contracts: "서비스 시그니처", "검증 스키마", "묶음 라우트 계약", "불변식".
- 현 `services/index.ts` 전문(이미 read됨). `setRoleCell`의 per-permission 가드를 그대로 함수로 옮긴다 — **에러 메시지 문자열을 한 글자도 바꾸지 말 것**(기존 service 테스트가 메시지로 단언).
- 현 `validations/index.ts`는 `setCellSchema`만 export.

## Deps

- Task 01 (검증 스키마가 `PERMISSION_GROUP_KEYS`를 import).

## Steps

### 1. 서비스 리팩터 + 묶음 추가 (`src/modules/admin/roles/services/index.ts`)

현 파일의 `setRoleCell` 함수(라인 21~59)를 아래 블록으로 **교체**한다. import 블록(1~6)과 `getRoleMatrix`·`assertOwner`(9~19)는 그대로 둔다.

```ts
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
  if (effect === "ALLOW" && s !== "all" && !allowedScopes(perm.resource).includes(s)) {
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
```

> 참고: import는 추가 불필요. `requirePermission`, `ForbiddenError`, `allowedScopes`(line 3), `NON_PRIVILEGED_ROLE_KEYS`, `CRITICAL_RESOURCE_PREFIXES`(line 4), `getMatrix`/`setCell`(line 5), `SetCellInput`(line 6)이 이미 import돼 있다.

### 2. 검증 스키마 추가 (`src/modules/admin/roles/validations/index.ts`)

파일 전체를 아래로 교체한다(`setCellSchema`는 유지하고 import + bulk만 추가).

```ts
import { z } from "zod";
import { PERMISSION_GROUP_KEYS } from "@/kernel/access/catalog";

export const setCellSchema = z.object({
  effect: z.enum(["none", "ALLOW", "DENY"]),
  scope: z.enum(["own", "team", "all"]).default("all"),
});
export type SetCellInput = z.infer<typeof setCellSchema>;

export const bulkSetSchema = z.object({
  resourcePrefix: z.string().refine(
    (v) => (PERMISSION_GROUP_KEYS as readonly string[]).includes(v),
    "unknown group",
  ),
  effect: z.enum(["none", "ALLOW", "DENY"]),
});
export type BulkSetInput = z.infer<typeof bulkSetSchema>;
```

### 3. 묶음 라우트 (`src/app/api/admin/roles/[roleId]/permissions/bulk/route.ts`)

신규 디렉터리/파일. 기존 단건 라우트(`[permissionId]/route.ts`)와 동일한 auth/에러 처리 형태.

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/kernel/access";
import { setRoleCellsBulk } from "@/modules/admin/roles/services";
import { bulkSetSchema } from "@/modules/admin/roles/validations";

export async function PUT(req: Request, { params }: { params: Promise<{ roleId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { roleId } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = bulkSetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    const result = await setRoleCellsBulk(session.user.id, roleId, parsed.data.resourcePrefix, parsed.data.effect);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
```

### 4. 실패 테스트 작성 (`tests/modules/admin/roles/matrix-bulk.test.ts`)

신규 파일(기존 `matrix-service.test.ts`의 모크를 건드리지 않도록 분리 — bulk는 `permission.findMany` 사용).

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    accessRole: { findUnique: vi.fn() },
    permission: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
const access = vi.hoisted(() => ({ requirePermission: vi.fn(), setCell: vi.fn() }));
vi.mock("@/kernel/access", async (orig) => ({ ...(await orig()), requirePermission: access.requirePermission }));
vi.mock("@/modules/admin/roles/repositories", async (orig) => ({ ...(await orig()), setCell: access.setCell }));

import { setRoleCellsBulk } from "@/modules/admin/roles/services";
import { ForbiddenError } from "@/kernel/access";

beforeEach(() => {
  vi.clearAllMocks();
  access.requirePermission.mockResolvedValue(undefined);
  access.setCell.mockResolvedValue(undefined);
  h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: false });
});

describe("setRoleCellsBulk", () => {
  it("ALLOW 전체: 매칭 권한 전부 적용(scope all)", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "regular-developer" });
    h.db.permission.findMany.mockResolvedValue([
      { id: "p1", resource: "calendar.work", action: "view" },
      { id: "p2", resource: "calendar.leave", action: "view" },
      { id: "p3", resource: "calendar.team", action: "view" },
    ]);
    const r = await setRoleCellsBulk("owner", "r1", "calendar", "ALLOW");
    expect(r).toEqual({ applied: 3, skipped: [] });
    expect(access.setCell).toHaveBeenCalledTimes(3);
    expect(access.setCell).toHaveBeenCalledWith("r1", "p1", "ALLOW", "all", "owner");
  });

  it("비특권 role × admin ALLOW: 전부 skip(권한 상승 차단), setCell 미호출", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "regular-developer" });
    h.db.permission.findMany.mockResolvedValue([
      { id: "p1", resource: "admin.users", action: "view" },
      { id: "p2", resource: "admin.users", action: "update" },
    ]);
    const r = await setRoleCellsBulk("owner", "r1", "admin", "ALLOW");
    expect(r.applied).toBe(0);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0].reason).toMatch(/비특권|상승/);
    expect(access.setCell).not.toHaveBeenCalled();
  });

  it("admin role × admin ALLOW: admin.roles:configure만 skip, 나머지 적용", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "admin" });
    h.db.permission.findMany.mockResolvedValue([
      { id: "p1", resource: "admin.users", action: "view" },
      { id: "p2", resource: "admin.roles", action: "configure" },
    ]);
    const r = await setRoleCellsBulk("owner", "r1", "admin", "ALLOW");
    expect(r.applied).toBe(1);
    expect(r.skipped).toEqual([{ key: "admin.roles:configure", reason: expect.stringMatching(/OWNER 전용/) }]);
    expect(access.setCell).toHaveBeenCalledTimes(1);
    expect(access.setCell).toHaveBeenCalledWith("r1", "p1", "ALLOW", "all", "owner");
  });

  it("DENY 전체: 비특권 role × admin도 전부 적용(제거는 상승 아님)", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "regular-developer" });
    h.db.permission.findMany.mockResolvedValue([
      { id: "p1", resource: "admin.users", action: "view" },
      { id: "p2", resource: "admin.roles", action: "configure" },
    ]);
    const r = await setRoleCellsBulk("owner", "r1", "admin", "DENY");
    expect(r.applied).toBe(2);
    expect(access.setCell).toHaveBeenCalledWith("r1", "p1", "DENY", "all", "owner");
    expect(access.setCell).toHaveBeenCalledWith("r1", "p2", "DENY", "all", "owner");
  });

  it("해제 전체(none): 매칭 권한 전부 제거", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "admin" });
    h.db.permission.findMany.mockResolvedValue([
      { id: "p1", resource: "admin.users", action: "view" },
    ]);
    const r = await setRoleCellsBulk("owner", "r1", "admin", "none");
    expect(r.applied).toBe(1);
    expect(access.setCell).toHaveBeenCalledWith("r1", "p1", "none", "all", "owner");
  });

  it("pm 역할은 거부(setCell 미호출)", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "pm" });
    await expect(setRoleCellsBulk("owner", "rpm", "admin", "ALLOW")).rejects.toThrow(/pm/);
    expect(access.setCell).not.toHaveBeenCalled();
  });

  it("비-OWNER actor는 거부(fail-closed, D8)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "ADMIN", status: "ACTIVE", mustChangePassword: false });
    h.db.accessRole.findUnique.mockResolvedValue({ key: "admin" });
    await expect(setRoleCellsBulk("u1", "r1", "admin", "ALLOW")).rejects.toBeInstanceOf(ForbiddenError);
    expect(access.setCell).not.toHaveBeenCalled();
  });
});
```

### 5. 테스트 실행

```bash
npm test -- matrix-bulk          # 7 passed
npm test -- matrix-service       # 기존 단건 가드 green (리팩터 회귀 없음)
```

### 6. 커밋

```bash
git add src/modules/admin/roles/services/index.ts src/modules/admin/roles/validations/index.ts "src/app/api/admin/roles/[roleId]/permissions/bulk/route.ts" tests/modules/admin/roles/matrix-bulk.test.ts
git commit -m "feat(roles): 묶음 권한 부여 서비스·라우트(per-cell 가드 재사용, skip-and-report)"
```

## Acceptance Criteria

```bash
npm test -- matrix-bulk          # 7 passed
npm test -- matrix-service       # 기존 green (단건 동작 불변)
npm test -- matrix-repo          # 기존 green
npm run typecheck                # 통과
npm run lint                     # 통과(boundaries 포함)
```

- 비특권 역할 × `admin` ALLOW → `applied:0`, 전부 skip. admin 역할 × `admin` ALLOW → `admin.roles:configure` 1건만 skip.
- 단건 `setRoleCell`의 기존 테스트 7케이스 전부 green(메시지·동작 불변).

## Cautions

- **`assertCellAllowed`의 에러 메시지 문자열을 바꾸지 말 것. 이유:** 기존 service 테스트가 `/OWNER 전용/`, `/지원하지 않/`, `/비특권|상승/`로 메시지를 단언한다. 문구가 바뀌면 회귀.
- **`assertOwner`·`setCell`(repository)을 수정하지 말 것. 이유:** in-tx OWNER 재확인(F-H)·advisory lock(F-BB)은 PR #15에서 굳힌 동시성 방어선. 묶음은 그것을 셀마다 **재사용**할 뿐 변경하지 않는다.
- **`bulk`는 `[permissionId]`의 형제 정적 세그먼트다. 이유:** Next.js는 정적(`bulk`)을 동적(`[permissionId]`)보다 우선 매칭하므로 충돌 없음 — 별도 라우트 파일로 둔다.
- **묶음을 하나의 큰 트랜잭션으로 묶지 말 것. 이유:** 셀 단위 트랜잭션(=`setCell` 재사용)이라야 부분 적용·셀별 advisory lock·셀별 audit가 그대로 성립한다(D6).
