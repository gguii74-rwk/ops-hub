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

// 삭제(F-6/P9): 직속 자식 캡처 → 확인 집합 대조 → cascadeDelete(parentUpdatedAt=클라가 본 버전, audit in-tx). 노드 없으면 Conflict.
export async function deleteNavigationItem(
  actorId: string, id: string, expectedUpdatedAt: Date, confirmedChildIds: string[],
): Promise<void> {
  await requirePermission(actorId, RESOURCE, "configure");
  const captured = await getNodeForDelete(id);
  if (!captured) throw new NavigationConflictError("메뉴를 찾을 수 없습니다.");
  // P9(TOCTOU): 확인 화면에 보인 자식 집합과 현재 DB 자식 집합이 다르면(렌더 후 추가/이동된 자식) 거부.
  // 그대로 진행하면 확인 안 된 자식이 cascade에 휩쓸려 삭제된다 — 부모 updatedAt은 자식 추가로 안 바뀌어 부모 CAS가 못 잡음.
  // (render→capture는 이 집합 비교가, capture→커밋은 cascadeDelete의 FK RESTRICT가 막는다 — SC-7/SC-8 F-6.)
  const current = captured.children.map((c) => c.id);
  const confirmed = new Set(confirmedChildIds);
  if (current.length !== confirmed.size || !current.every((cid) => confirmed.has(cid))) {
    throw new NavigationConflictError("하위 메뉴 구성이 변경되었습니다. 새로고침 후 다시 시도하세요.");
  }
  await cascadeDelete({ parentId: id, parentUpdatedAt: expectedUpdatedAt, children: captured.children }, actorId);
}
