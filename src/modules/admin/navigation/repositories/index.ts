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

// 생성 — 서버 opaque key + 형제 말미 sortOrder. 모든 생성이 트리락(P5) — top-level 포함.
// 락 없이 형제 sortOrder를 읽고 +10하면 동시 top-level 생성/재정렬이 stale로 sortOrder를 중복시킨다.
// parentId 있으면 깊이검증(D6)도 락 안에서. audit는 같은 트랜잭션 내(P1) — 실패 시 create 롤백.
export async function createItem(input: CreateNavInput, actorId: string): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    await lockNavTree(tx); // P5: top-level 포함 모든 생성을 reorder/reparent와 동일 락으로 직렬화
    if (input.parentId) {
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

// 재정렬 — reparent/cascade와 동일 트리락으로 직렬화(P3) 후 무중복+형제 집합 정확 일치 검증,
// 인덱스별 sortOrder를 (id,parentId,updatedAt) CAS로 재부여(트랜잭션). audit in-tx(P1).
// 락은 인터리빙만 막고 lost-update는 못 막는다: 두 관리자가 같은 형제를 동시 재정렬하면 둘째의 stale 순서가
// 첫째 변경을 조용히 덮어쓴다(P6). 형제별 관측 updatedAt CAS로 — 먼저 바뀌어 updatedAt이 달라진 행은
// count 0 → Conflict. parentId 불일치(reparent-away)도 같은 CAS로 잡힌다(P3). 중복 ID는 거부(P2).
export async function reorderSiblings(input: ReorderNavInput, actorId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockNavTree(tx); // P3: reparent/cascade와 동일 advisory lock으로 직렬화
    const current = await tx.navigationItem.findMany({
      where: { parentId: input.parentId ?? null },
      select: { id: true },
    });
    const currentIds = new Set(current.map((c) => c.id));
    const ids = input.orderedItems.map((i) => i.id);
    const noDupes = new Set(ids).size === ids.length;
    const sameSet = noDupes && currentIds.size === ids.length && ids.every((id) => currentIds.has(id));
    if (!sameSet) {
      throw new NavigationConflictError("형제 메뉴 구성이 변경되었습니다. 새로고침 후 다시 시도하세요.");
    }
    for (let i = 0; i < input.orderedItems.length; i++) {
      const item = input.orderedItems[i];
      // (id,parentId,updatedAt) CAS — reparent-away(parentId)·동시 재정렬/편집(updatedAt)이면 count 0 → Conflict(P3+P6).
      const res = await tx.navigationItem.updateMany({
        where: { id: item.id, parentId: input.parentId ?? null, updatedAt: item.updatedAt },
        data: { sortOrder: (i + 1) * 10 },
      });
      if (res.count !== 1) {
        throw new NavigationConflictError("형제 메뉴 구성이 변경되었습니다. 새로고침 후 다시 시도하세요.");
      }
    }
    await writeAudit(tx, {
      actorId, entityType: "NavigationItem", entityId: input.parentId, action: "reorder",
      metadata: { parentId: input.parentId, orderedIds: ids },
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
