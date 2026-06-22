# task-09 — services: 게이트·audit·캡처·역할 미리보기

**목적:** 쓰기 경로 서비스 계층. 모든 변경 진입에서 `requirePermission(...configure)`(D9), 변경 후 `AuditLog` 기록(D16), 삭제 시 자식 캡처→`cascadeDelete` 위임(F-6), 역할 미리보기 위임(D10).

## Files

- **Create:** `src/modules/admin/navigation/services/index.ts`
- **Create (test):** `tests/modules/admin/navigation/services.test.ts`

## Prep

- 스펙 §8(쓰기 경로)·결정 D9/D10/D11/D16.
- 엔트리포인트 §Shared Contracts **SC-3**(권한키)·**SC-8**(캡처→cascade)·**SC-9**(에러).
- 기존 출처: `src/modules/admin/users/services/index.ts`(서비스 패턴), `src/kernel/access`(`requirePermission`). audit는 repo가 in-tx 기록(task-07/08) — 서비스는 호출하지 않음.
- task-07/08 repo 함수: `getNavigationTree`/`createItem`/`updateItem`/`reorderSiblings`/`reparentItem`/`cascadeDelete`/`getNodeForDelete`/`rolesGrantingPermission`.

## Deps

task-07, task-08(repo 함수 전체).

## Cautions

- **읽기는 라우트가 게이트(view), 변경은 서비스가 게이트(configure)** — 스펙 §8 "모든 변경 진입에서 requirePermission". 읽기 함수(`listNavigationTree`/`previewRoles`)는 서비스에서 재게이트하지 않는다(라우트 `authorize(view)` 담당 — users 패턴).
- **삭제 캡처는 서비스 책임:** `getNodeForDelete(id)`로 직속 자식 `(id, updatedAt)`을 캡처해 `cascadeDelete`에 넘긴다. `parentUpdatedAt`은 **클라가 본 버전(expectedUpdatedAt)** — 부모 stale-tab lost-update 차단(SC-7).
- **audit는 서비스가 따로 기록하지 않는다(P1)** — repo 변경 함수가 같은 트랜잭션에서 `writeAudit(tx, ...)` 한다(task-07/08). 서비스는 게이트 + `actorId` 전달만. (커밋-후-audit 분리는 audit 실패 시 변경이 커밋된 채 실패 반환 → 재시도 중복 생성 위험 — 그래서 in-tx.)
- 권한 거부(requirePermission throw) 시 repo가 호출되면 안 된다(게이트가 최우선).

## Step 1 — 실패 테스트

`tests/modules/admin/navigation/services.test.ts` 생성:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const repo = vi.hoisted(() => ({
  getNavigationTree: vi.fn(), createItem: vi.fn(), updateItem: vi.fn(),
  reorderSiblings: vi.fn(), reparentItem: vi.fn(), cascadeDelete: vi.fn(),
  getNodeForDelete: vi.fn(), rolesGrantingPermission: vi.fn(), listSelectablePermissions: vi.fn(),
}));
const requirePermissionMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/admin/navigation/repositories", () => repo);
vi.mock("@/kernel/access", () => ({ requirePermission: requirePermissionMock }));

import {
  createNavigationItem, updateNavigationItem, deleteNavigationItem,
  reparentNavigationItem, reorderNavigationItems, previewRoles,
} from "@/modules/admin/navigation/services";
import { NavigationConflictError } from "@/modules/admin/navigation/errors";

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(undefined);
});

// audit는 repo가 in-tx로 기록(P1) — 서비스 책임 아님. 서비스 테스트는 게이트·actorId 전달·캡처만 검증.
describe("navigation services — 게이트·actorId 전달", () => {
  it("create: configure 게이트 → createItem(input, actorId)", async () => {
    repo.createItem.mockResolvedValue({ id: "n1" });
    const input = { label: "메뉴", href: "/x", parentId: null, requiredPermissionId: null };
    const out = await createNavigationItem("admin1", input);
    expect(requirePermissionMock).toHaveBeenCalledWith("admin1", "admin.navigation", "configure");
    expect(repo.createItem).toHaveBeenCalledWith(input, "admin1");
    expect(out).toEqual({ id: "n1" });
  });

  it("권한 거부 시 repo 미호출", async () => {
    requirePermissionMock.mockRejectedValue(new Error("forbidden"));
    await expect(createNavigationItem("u", { label: "x", href: null, parentId: null, requiredPermissionId: null })).rejects.toThrow();
    expect(repo.createItem).not.toHaveBeenCalled();
  });

  it("update: 게이트 → updateItem(id, patch, expectedUpdatedAt, actorId)", async () => {
    const at = new Date("2026-06-22T00:00:00Z");
    await updateNavigationItem("admin1", "n1", { label: "새이름" }, at);
    expect(repo.updateItem).toHaveBeenCalledWith("n1", { label: "새이름" }, at, "admin1");
  });

  it("delete: 캡처 자식으로 cascadeDelete(input, actorId)", async () => {
    const at = new Date("2026-06-22T00:00:00Z");
    repo.getNodeForDelete.mockResolvedValue({ children: [{ id: "c1", updatedAt: at }] });
    await deleteNavigationItem("admin1", "p1", at);
    expect(repo.cascadeDelete).toHaveBeenCalledWith(
      { parentId: "p1", parentUpdatedAt: at, children: [{ id: "c1", updatedAt: at }] },
      "admin1",
    );
  });

  it("delete: 노드 없으면 Conflict(cascade 미호출)", async () => {
    repo.getNodeForDelete.mockResolvedValue(null);
    await expect(deleteNavigationItem("admin1", "x", new Date())).rejects.toBeInstanceOf(NavigationConflictError);
    expect(repo.cascadeDelete).not.toHaveBeenCalled();
  });

  it("reparent: 게이트 → reparentItem({id,newParentId,expectedUpdatedAt}, actorId)", async () => {
    const at = new Date("2026-06-22T00:00:00Z");
    await reparentNavigationItem("admin1", "a", "b", at);
    expect(requirePermissionMock).toHaveBeenCalledWith("admin1", "admin.navigation", "configure");
    expect(repo.reparentItem).toHaveBeenCalledWith({ id: "a", newParentId: "b", expectedUpdatedAt: at }, "admin1");
  });

  it("reorder: 게이트 → reorderSiblings(input, actorId)", async () => {
    await reorderNavigationItems("admin1", { parentId: null, orderedIds: ["a", "b"] });
    expect(repo.reorderSiblings).toHaveBeenCalledWith({ parentId: null, orderedIds: ["a", "b"] }, "admin1");
  });

  it("previewRoles: 읽기 — 서비스 게이트 없이 위임(라우트가 view 게이트)", async () => {
    repo.rolesGrantingPermission.mockResolvedValue([{ key: "admin", name: "관리자" }]);
    const out = await previewRoles("p1");
    expect(requirePermissionMock).not.toHaveBeenCalled();
    expect(out).toEqual([{ key: "admin", name: "관리자" }]);
  });
});
```

실행: `npm test -- navigation/services` → **FAIL**.

## Step 2 — services/index.ts

`src/modules/admin/navigation/services/index.ts`:

```ts
import "server-only";
import { requirePermission } from "@/kernel/access";
import {
  getNavigationTree, createItem, updateItem, reorderSiblings, reparentItem,
  cascadeDelete, getNodeForDelete, rolesGrantingPermission, listSelectablePermissions,
  type NavigationNodeAdmin,
} from "../repositories";
import type { CreateNavInput, UpdateNavInput, ReorderNavInput } from "../validations";
import { NavigationConflictError } from "../errors";

const RESOURCE = "admin.navigation";

// ── 읽기(게이트는 라우트 authorize(view)) ──
export function listNavigationTree(): Promise<NavigationNodeAdmin[]> {
  return getNavigationTree();
}
export function listPermissionOptions(): Promise<Array<{ id: string; resource: string; action: string }>> {
  return listSelectablePermissions();
}
export function previewRoles(permissionId: string): Promise<Array<{ key: string; name: string }>> {
  return rolesGrantingPermission(permissionId);
}

// ── 변경(서비스가 configure 게이트 — 스펙 §8). audit는 repo가 같은 트랜잭션에서 기록(P1) — 여기서 따로 안 함. ──
export async function createNavigationItem(actorId: string, input: CreateNavInput): Promise<{ id: string }> {
  await requirePermission(actorId, RESOURCE, "configure");
  return createItem(input, actorId);
}

export async function updateNavigationItem(
  actorId: string, id: string, patch: UpdateNavInput, expectedUpdatedAt: Date,
): Promise<void> {
  await requirePermission(actorId, RESOURCE, "configure");
  await updateItem(id, patch, expectedUpdatedAt, actorId);
}

export async function reorderNavigationItems(actorId: string, input: ReorderNavInput): Promise<void> {
  await requirePermission(actorId, RESOURCE, "configure");
  await reorderSiblings(input, actorId);
}

export async function reparentNavigationItem(
  actorId: string, id: string, newParentId: string | null, expectedUpdatedAt: Date,
): Promise<void> {
  await requirePermission(actorId, RESOURCE, "configure");
  await reparentItem({ id, newParentId, expectedUpdatedAt }, actorId);
}

// 삭제(F-6): 직속 자식 캡처 → cascadeDelete(parentUpdatedAt=클라가 본 버전, audit in-tx). 노드 없으면 Conflict.
export async function deleteNavigationItem(actorId: string, id: string, expectedUpdatedAt: Date): Promise<void> {
  await requirePermission(actorId, RESOURCE, "configure");
  const captured = await getNodeForDelete(id);
  if (!captured) throw new NavigationConflictError("메뉴를 찾을 수 없습니다.");
  await cascadeDelete({ parentId: id, parentUpdatedAt: expectedUpdatedAt, children: captured.children }, actorId);
}
```

실행: `npm test -- navigation/services` → **PASS**.

## Acceptance Criteria

- `npm test -- navigation/services` → 전부 PASS.
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 errors(boundaries: module→kernel/lib OK).
- 모든 변경 함수가 `requirePermission(...,"configure")`를 **repo 호출 전에** 부른다(게이트 우선).
