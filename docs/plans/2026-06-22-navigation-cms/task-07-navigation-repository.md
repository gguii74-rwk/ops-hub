# task-07 — repository: 트리·생성(opaque key)·CAS 수정·재정렬·역할 미리보기

**목적:** 신규 모듈의 Prisma 접근 계층을 구현한다. 관리 트리 조회, 생성(서버 opaque key — D17), CAS 수정(낙관락 — D12), 형제 재정렬(트랜잭션), 역할 미리보기 쿼리(D10). 동시성 헬퍼(`lockNavTree`/`assertParentTopLevel`)를 정의해 task-08(cascade·reparent)이 재사용한다.

## Files

- **Create:** `src/modules/admin/navigation/repositories/index.ts` — 헬퍼 + `NavigationNodeAdmin` + CRUD.
- **Create (test):** `tests/modules/admin/navigation/repositories.test.ts`

## Prep

- 스펙 §8(쓰기 경로)·결정 D6/D10/D12/D17.
- 엔트리포인트 §Shared Contracts **SC-5**(`generateNavKey`)·**SC-6**(`NavigationNodeAdmin`)·**SC-7**(낙관락)·**SC-8**(advisory lock 네임스페이스)·**SC-9**(에러).
- 기존 출처: `src/modules/leave/repositories/index.ts`(`$transaction`·CAS `updateMany`+`count===0`·`pg_advisory_xact_lock` 패턴), `tests/modules/leave/repositories.test.ts`(모킹 prisma 하니스).
- task-06(`CreateNavInput`/`UpdateNavInput`/`ReorderNavInput`·`NavigationConflictError`/`NavigationValidationError`).

## Deps

task-01(FK RESTRICT 전제), task-02(카탈로그), task-06(타입·에러).

## Cautions

- **`key`는 서버 생성·불변(D17)** — `generateNavKey()`만 사용. **라벨에서 파생 금지**(한글/중복 라벨 충돌 방지). update 경로는 key를 절대 건드리지 않는다.
- **CAS는 클라가 본 `updatedAt`으로**(SC-7) — 서버 재로드값 아님. `updateMany({where:{id, updatedAt}})` + `count===0` → `NavigationConflictError`.
- **깊이 2단(D6):** 자식 아래 자식 금지. `assertParentTopLevel`은 부모의 `parentId == null`을 강제. child-create는 `lockNavTree` 안에서 검증(task-08 reparent와 동일 락으로 직렬화 — 동시 reparent가 부모를 자식으로 만드는 레이스 차단).
- **cascade 삭제·reparent는 본 태스크에 두지 말 것** — task-08(F-6/F-7 전용 동시성 코어). 본 태스크는 헬퍼만 제공.
- `rolesGrantingPermission`은 **역할 ALLOW만**(D10) — override·OWNER 제외. scope별 중복 행은 dedup.
- **audit는 변경 repo 함수의 트랜잭션 내부에서 기록(P1 — `writeAudit(tx, ...)`)** — 서비스에서 post-commit으로 따로 기록하지 말 것. 변경 커밋 후 audit가 실패하면 라우트가 실패를 반환하는데 행은 이미 존재 → 재시도가 랜덤 key로 중복 생성한다. in-tx면 audit 실패 시 변경도 롤백 → 재시도 안전. (leave `deleteByAdminTx` 패턴 동형.)
- **reorder 중복 ID 거부(P2):** zod(task-06)에 더해 repo도 무중복+집합 정확 일치를 재검증. 중복이 통과하면 한 행을 두 번 갱신·다른 형제 누락으로 sortOrder가 손상된다.

## Step 1 — 실패 테스트

`tests/modules/admin/navigation/repositories.test.ts` 생성:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const db = {
    navigationItem: {
      findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
      create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    },
    rolePermission: { findMany: vi.fn() },
    permission: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  };
  const prisma = { ...db, $transaction: vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db)) };
  return { db, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
const writeAuditMock = vi.hoisted(() => vi.fn());
vi.mock("@/kernel/audit", () => ({ writeAudit: (...a: unknown[]) => writeAuditMock(...a) }));

import {
  createItem, updateItem, reorderSiblings, rolesGrantingPermission, generateNavKey, getNodeForDelete,
  listSelectablePermissions,
} from "@/modules/admin/navigation/repositories";
import { NavigationConflictError, NavigationValidationError } from "@/modules/admin/navigation/errors";

beforeEach(() => { vi.clearAllMocks(); });

describe("generateNavKey (D17)", () => {
  it("nav_ 접두 opaque key, 호출마다 상이(라벨 무관)", () => {
    const a = generateNavKey();
    const b = generateNavKey();
    expect(a).toMatch(/^nav_[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
  });
});

describe("createItem", () => {
  it("대메뉴(parentId null): 락 미사용, 형제 말미 sortOrder, 서버 생성 key, audit in-tx", async () => {
    h.db.navigationItem.findFirst.mockResolvedValue({ sortOrder: 20 });
    h.db.navigationItem.create.mockResolvedValue({ id: "n1" });
    await createItem({ label: "메뉴", href: "/x", parentId: null, requiredPermissionId: null }, "admin1");
    expect(h.db.$queryRaw).not.toHaveBeenCalled(); // 대메뉴는 트리락 불필요
    const data = h.db.navigationItem.create.mock.calls[0][0].data;
    expect(data.sortOrder).toBe(30);
    expect(data.parentId).toBe(null);
    expect(data.key).toMatch(/^nav_/);
    expect(data.key).not.toBe("메뉴"); // 라벨 파생 아님
    // audit는 같은 트랜잭션(tx) 인자로 기록(P1).
    expect(writeAuditMock).toHaveBeenCalledWith(h.db, expect.objectContaining({
      actorId: "admin1", entityType: "NavigationItem", entityId: "n1", action: "create",
    }));
  });

  it("중메뉴(parentId 있음): 트리락 + 부모 top-level 검증 후 생성", async () => {
    h.db.navigationItem.findUnique.mockResolvedValue({ parentId: null }); // 부모가 top-level
    h.db.navigationItem.findFirst.mockResolvedValue(null);                 // 형제 없음
    h.db.navigationItem.create.mockResolvedValue({ id: "c1" });
    await createItem({ label: "자식", href: "/x/y", parentId: "p1", requiredPermissionId: null }, "admin1");
    expect(h.db.$queryRaw).toHaveBeenCalled(); // lockNavTree
    const data = h.db.navigationItem.create.mock.calls[0][0].data;
    expect(data.parentId).toBe("p1");
    expect(data.sortOrder).toBe(10);
  });

  it("부모가 이미 자식이면(깊이 위반) NavigationValidationError", async () => {
    h.db.navigationItem.findUnique.mockResolvedValue({ parentId: "g1" }); // 부모가 중메뉴
    await expect(
      createItem({ label: "자식", href: "/x", parentId: "p1", requiredPermissionId: null }, "admin1"),
    ).rejects.toBeInstanceOf(NavigationValidationError);
    expect(h.db.navigationItem.create).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});

describe("updateItem (CAS 낙관락 + audit in-tx)", () => {
  const at = new Date("2026-06-22T00:00:00Z");
  it("count 1이면 통과, CAS where에 updatedAt 포함, audit 기록", async () => {
    h.db.navigationItem.updateMany.mockResolvedValue({ count: 1 });
    await updateItem("n1", { label: "새이름" }, at, "admin1");
    expect(h.db.navigationItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "n1", updatedAt: at },
    }));
    expect(writeAuditMock).toHaveBeenCalledWith(h.db, expect.objectContaining({ action: "update", entityId: "n1" }));
  });
  it("count 0이면 NavigationConflictError(audit 미기록)", async () => {
    h.db.navigationItem.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateItem("n1", { label: "x" }, at, "admin1")).rejects.toBeInstanceOf(NavigationConflictError);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});

describe("reorderSiblings (트랜잭션 + 집합 일치 + audit)", () => {
  it("형제 집합 일치 시 인덱스별 sortOrder 재부여 + audit", async () => {
    h.db.navigationItem.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    h.db.navigationItem.update.mockResolvedValue({});
    await reorderSiblings({ parentId: null, orderedIds: ["b", "a"] }, "admin1");
    expect(h.db.navigationItem.update).toHaveBeenNthCalledWith(1, { where: { id: "b" }, data: { sortOrder: 10 } });
    expect(h.db.navigationItem.update).toHaveBeenNthCalledWith(2, { where: { id: "a" }, data: { sortOrder: 20 } });
    expect(writeAuditMock).toHaveBeenCalledWith(h.db, expect.objectContaining({ action: "reorder" }));
  });
  it("형제 구성이 바뀌면 NavigationConflictError(부분 갱신 없음)", async () => {
    h.db.navigationItem.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    await expect(reorderSiblings({ parentId: null, orderedIds: ["a"] }, "admin1")).rejects.toBeInstanceOf(NavigationConflictError);
    expect(h.db.navigationItem.update).not.toHaveBeenCalled();
  });
  it("중복 ID(P2)면 NavigationConflictError(부분 갱신 없음)", async () => {
    h.db.navigationItem.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    await expect(reorderSiblings({ parentId: null, orderedIds: ["a", "a"] }, "admin1")).rejects.toBeInstanceOf(NavigationConflictError);
    expect(h.db.navigationItem.update).not.toHaveBeenCalled();
  });
});

describe("rolesGrantingPermission (D10)", () => {
  it("ALLOW 역할만 dedup 반환", async () => {
    h.db.rolePermission.findMany.mockResolvedValue([
      { role: { key: "admin", name: "관리자" } },
      { role: { key: "admin", name: "관리자" } }, // scope별 중복
      { role: { key: "pm", name: "PM" } },
    ]);
    const out = await rolesGrantingPermission("perm1");
    expect(out).toEqual([{ key: "admin", name: "관리자" }, { key: "pm", name: "PM" }]);
    expect(h.db.rolePermission.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { permissionId: "perm1", effect: "ALLOW" },
    }));
  });
});

describe("listSelectablePermissions", () => {
  it("resource·action 정렬로 권한 목록 반환", async () => {
    h.db.permission.findMany.mockResolvedValue([{ id: "p1", resource: "admin.navigation", action: "view" }]);
    const out = await listSelectablePermissions();
    expect(out).toEqual([{ id: "p1", resource: "admin.navigation", action: "view" }]);
    expect(h.db.permission.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ resource: "asc" }, { action: "asc" }],
    }));
  });
});

describe("getNodeForDelete (F-6 캡처)", () => {
  it("존재하면 직속 자식 (id, updatedAt) 캡처, 없으면 null", async () => {
    const at = new Date("2026-06-22T00:00:00Z");
    h.db.navigationItem.findUnique.mockResolvedValueOnce({ id: "p1", children: [{ id: "c1", updatedAt: at }] });
    expect(await getNodeForDelete("p1")).toEqual({ children: [{ id: "c1", updatedAt: at }] });
    h.db.navigationItem.findUnique.mockResolvedValueOnce(null);
    expect(await getNodeForDelete("x")).toBeNull();
  });
});
```

실행: `npm test -- navigation/repositories` → **FAIL**.

## Step 2 — repositories/index.ts

`src/modules/admin/navigation/repositories/index.ts`:

```ts
import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/kernel/audit";
import { NavigationConflictError, NavigationValidationError } from "../errors";
import type { CreateNavInput, UpdateNavInput, ReorderNavInput } from "../validations";

// 관리 트리 행(repo 반환 shape — SC-6). updatedAt = 낙관락 키.
export interface NavigationNodeAdmin {
  id: string;
  key: string;
  label: string;
  href: string | null;
  parentId: string | null;
  sortOrder: number;
  requiredPermissionId: string | null;
  isActive: boolean;
  updatedAt: Date;
  children: NavigationNodeAdmin[];
}

// 라벨과 무관한 불변 opaque key(D17). 96비트 base64url — 충돌 무시 가능(unique 제약이 최종 가드).
export function generateNavKey(): string {
  return `nav_${randomBytes(12).toString("base64url")}`;
}

// SC-8 트리락 — child-create/reparent/cascade를 직렬화(단일 전역 키). 트랜잭션 내부에서만 호출.
// leave lockUserAndAssertNoOverlap의 advisory xact lock 패턴 동형. 트리 변경은 드물어 전역 직렬화로 충분.
const NAV_REPARENT_LOCK_NS = 0x6e76; // 'nv'
async function lockNavTree(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${NAV_REPARENT_LOCK_NS}::int4, 0::int4)`;
}

// 깊이 2단 강제(D6): 부모는 parentId == null인 노드만. 락 안에서 호출해 동시 reparent 레이스 차단.
async function assertParentTopLevel(tx: Prisma.TransactionClient, parentId: string): Promise<void> {
  const parent = await tx.navigationItem.findUnique({ where: { id: parentId }, select: { parentId: true } });
  if (!parent) throw new NavigationValidationError("부모 메뉴를 찾을 수 없습니다.");
  if (parent.parentId !== null) throw new NavigationValidationError("중메뉴 아래에는 메뉴를 둘 수 없습니다(2단까지).");
}
// (lockNavTree·assertParentTopLevel은 모듈-private. task-08이 같은 파일에 cascade·reparent를 덧붙여 in-scope로 재사용.)

const ADMIN_NODE_SELECT = {
  id: true, key: true, label: true, href: true, parentId: true,
  sortOrder: true, requiredPermissionId: true, isActive: true, updatedAt: true,
} as const;

// 관리 트리 전체(활성·비활성 모두) — 정렬 포함.
export async function getNavigationTree(): Promise<NavigationNodeAdmin[]> {
  const items = await prisma.navigationItem.findMany({
    where: { parentId: null },
    orderBy: { sortOrder: "asc" },
    select: {
      ...ADMIN_NODE_SELECT,
      children: { orderBy: { sortOrder: "asc" }, select: ADMIN_NODE_SELECT },
    },
  });
  return items.map((p) => ({ ...p, children: p.children.map((c) => ({ ...c, children: [] })) }));
}

// 삭제 캡처(D11/F-6) — 노드 존재 확인 + 직속 자식 (id, updatedAt) 캡처. 서비스가 cascadeDelete에 넘긴다.
export async function getNodeForDelete(
  id: string,
): Promise<{ children: Array<{ id: string; updatedAt: Date }> } | null> {
  const node = await prisma.navigationItem.findUnique({
    where: { id },
    select: { id: true, children: { select: { id: true, updatedAt: true } } },
  });
  if (!node) return null;
  return { children: node.children };
}

// 생성 — 서버 opaque key + 형제 말미 sortOrder. parentId 있으면 락+깊이검증(D6).
// audit는 같은 트랜잭션 내(P1) — 실패 시 create도 롤백 → 재시도 안전(랜덤 key 중복 생성 방지).
export async function createItem(input: CreateNavInput, actorId: string): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    if (input.parentId) {
      await lockNavTree(tx);
      await assertParentTopLevel(tx, input.parentId);
    }
    const last = await tx.navigationItem.findFirst({
      where: { parentId: input.parentId ?? null },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const sortOrder = (last?.sortOrder ?? 0) + 10;
    const created = await tx.navigationItem.create({
      data: {
        key: generateNavKey(),
        label: input.label,
        href: input.href,
        parentId: input.parentId ?? null,
        requiredPermissionId: input.requiredPermissionId ?? null,
        sortOrder,
        isActive: true,
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      actorId, entityType: "NavigationItem", entityId: created.id, action: "create",
      metadata: { label: input.label, parentId: input.parentId },
    });
    return created;
  });
}

// 수정 — CAS 낙관락(클라가 본 updatedAt). parentId는 건드리지 않음(이동은 reparent 전용).
// updateMany + audit를 한 트랜잭션으로(P1) — audit 실패 시 변경 롤백.
export async function updateItem(
  id: string, patch: UpdateNavInput, expectedUpdatedAt: Date, actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.navigationItem.updateMany({
      where: { id, updatedAt: expectedUpdatedAt },
      data: {
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.href !== undefined ? { href: patch.href } : {}),
        ...(patch.requiredPermissionId !== undefined ? { requiredPermissionId: patch.requiredPermissionId } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });
    if (updated.count === 0) throw new NavigationConflictError();
    await writeAudit(tx, { actorId, entityType: "NavigationItem", entityId: id, action: "update", metadata: { patch } });
  });
}

// 재정렬 — 무중복 + 형제 집합 정확 일치 검증 후 인덱스별 sortOrder 재부여(트랜잭션). audit in-tx(P1).
// 중복 ID는 한 행을 두 번 갱신하고 다른 형제를 누락해 sortOrder를 손상시킨다(P2) → 거부.
export async function reorderSiblings(input: ReorderNavInput, actorId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.navigationItem.findMany({
      where: { parentId: input.parentId ?? null },
      select: { id: true },
    });
    const currentIds = new Set(current.map((c) => c.id));
    const noDupes = new Set(input.orderedIds).size === input.orderedIds.length;
    const sameSet =
      noDupes && currentIds.size === input.orderedIds.length && input.orderedIds.every((id) => currentIds.has(id));
    if (!sameSet) {
      throw new NavigationConflictError("형제 메뉴 구성이 변경되었습니다. 새로고침 후 다시 시도하세요.");
    }
    for (let i = 0; i < input.orderedIds.length; i++) {
      await tx.navigationItem.update({ where: { id: input.orderedIds[i] }, data: { sortOrder: (i + 1) * 10 } });
    }
    await writeAudit(tx, {
      actorId, entityType: "NavigationItem", entityId: input.parentId, action: "reorder",
      metadata: { parentId: input.parentId, orderedIds: input.orderedIds },
    });
  });
}

// 권한 select 옵션(D15) — 관리 UI의 필요권한 드롭다운. 기존 카탈로그 권한만(새 Permission 생성 없음).
export async function listSelectablePermissions(): Promise<Array<{ id: string; resource: string; action: string }>> {
  return prisma.permission.findMany({
    orderBy: [{ resource: "asc" }, { action: "asc" }],
    select: { id: true, resource: true, action: true },
  });
}

// 역할 미리보기(D10) — 이 권한을 ALLOW하는 역할(override·OWNER 제외, scope dedup).
export async function rolesGrantingPermission(permissionId: string): Promise<Array<{ key: string; name: string }>> {
  const rows = await prisma.rolePermission.findMany({
    where: { permissionId, effect: "ALLOW" },
    select: { role: { select: { key: true, name: true } } },
  });
  const byKey = new Map<string, { key: string; name: string }>();
  for (const r of rows) byKey.set(r.role.key, r.role);
  return [...byKey.values()];
}
```

실행: `npm test -- navigation/repositories` → **PASS**.

## Acceptance Criteria

- `npm test -- navigation/repositories` → 전부 PASS.
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 errors(boundaries: module→kernel/lib OK).
- `generateNavKey`가 라벨과 무관함을 테스트가 고정(D17).
- 변경 함수(`createItem`/`updateItem`/`reorderSiblings`)가 `actorId`를 받아 **같은 트랜잭션에서** `writeAudit(tx,...)` 호출(P1). 충돌·검증 실패 시 audit 미기록을 테스트가 고정.
- `reorderSiblings`가 중복 ID를 `NavigationConflictError`로 거부(P2).
