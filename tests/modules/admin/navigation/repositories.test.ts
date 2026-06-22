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
  it("대메뉴(parentId null): 트리락 획득(P5), 형제 말미 sortOrder, 서버 생성 key, audit in-tx", async () => {
    h.db.navigationItem.findFirst.mockResolvedValue({ sortOrder: 20 });
    h.db.navigationItem.create.mockResolvedValue({ id: "n1" });
    await createItem({ label: "메뉴", href: "/x", parentId: null, requiredPermissionId: null }, "admin1");
    expect(h.db.$queryRaw).toHaveBeenCalled(); // P5: top-level 생성도 트리락으로 sortOrder 경쟁 차단
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

describe("reorderSiblings (락 + 집합 일치 + (id,parentId,updatedAt) CAS + audit)", () => {
  const at = new Date("2026-06-22T00:00:00Z");
  const items = (...ids: string[]) => ids.map((id) => ({ id, updatedAt: at }));
  it("형제 집합 일치 시 락 획득·버전 CAS로 sortOrder 재부여 + audit", async () => {
    h.db.navigationItem.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    h.db.navigationItem.updateMany.mockResolvedValue({ count: 1 });
    await reorderSiblings({ parentId: null, orderedItems: items("b", "a") }, "admin1");
    expect(h.db.$queryRaw).toHaveBeenCalled(); // lockNavTree(P3)
    expect(h.db.navigationItem.updateMany).toHaveBeenNthCalledWith(1, { where: { id: "b", parentId: null, updatedAt: at }, data: { sortOrder: 10 } });
    expect(h.db.navigationItem.updateMany).toHaveBeenNthCalledWith(2, { where: { id: "a", parentId: null, updatedAt: at }, data: { sortOrder: 20 } });
    expect(writeAuditMock).toHaveBeenCalledWith(h.db, expect.objectContaining({ action: "reorder" }));
  });
  it("P6: 동시 재정렬로 한 형제 updatedAt이 stale(CAS count 0)이면 Conflict", async () => {
    h.db.navigationItem.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    h.db.navigationItem.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(reorderSiblings({ parentId: null, orderedItems: items("b", "a") }, "admin1")).rejects.toBeInstanceOf(NavigationConflictError);
  });
  it("P3: reparent-away(parentId 불일치)도 같은 CAS로 count 0 → Conflict", async () => {
    h.db.navigationItem.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    h.db.navigationItem.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(reorderSiblings({ parentId: null, orderedItems: items("b", "a") }, "admin1")).rejects.toBeInstanceOf(NavigationConflictError);
  });
  it("형제 구성이 바뀌면 NavigationConflictError(CAS 전 차단)", async () => {
    h.db.navigationItem.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    await expect(reorderSiblings({ parentId: null, orderedItems: items("a") }, "admin1")).rejects.toBeInstanceOf(NavigationConflictError);
    expect(h.db.navigationItem.updateMany).not.toHaveBeenCalled();
  });
  it("중복 ID(P2)면 NavigationConflictError(CAS 전 차단)", async () => {
    h.db.navigationItem.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    await expect(reorderSiblings({ parentId: null, orderedItems: items("a", "a") }, "admin1")).rejects.toBeInstanceOf(NavigationConflictError);
    expect(h.db.navigationItem.updateMany).not.toHaveBeenCalled();
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
