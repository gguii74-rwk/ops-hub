import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const h = vi.hoisted(() => {
  const db = {
    navigationItem: {
      findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn(),
      deleteMany: vi.fn(), updateMany: vi.fn(),
    },
    $executeRaw: vi.fn(),
  };
  const prisma = { ...db, $transaction: vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db)) };
  return { db, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
const writeAuditMock = vi.hoisted(() => vi.fn());
vi.mock("@/kernel/audit", () => ({ writeAudit: (...a: unknown[]) => writeAuditMock(...a) }));

import { cascadeDelete, reparentItem } from "@/modules/admin/navigation/repositories";
import { NavigationConflictError, NavigationValidationError } from "@/modules/admin/navigation/errors";

beforeEach(() => { vi.clearAllMocks(); });

const cAt = new Date("2026-06-22T00:00:00Z");
const pAt = new Date("2026-06-21T00:00:00Z");

describe("cascadeDelete (F-6)", () => {
  it("정상: captured 자식 전부 CAS 삭제 후 부모 삭제(트리락 사용) + audit in-tx", async () => {
    h.db.navigationItem.deleteMany
      .mockResolvedValueOnce({ count: 1 }) // child c1
      .mockResolvedValueOnce({ count: 1 }) // child c2
      .mockResolvedValueOnce({ count: 1 }); // parent
    await cascadeDelete({
      parentId: "p1", parentUpdatedAt: pAt,
      children: [{ id: "c1", updatedAt: cAt }, { id: "c2", updatedAt: cAt }],
    }, "admin1");
    expect(h.db.$executeRaw).toHaveBeenCalled(); // lockNavTree
    // 각 자식 CAS where: id+parentId+updatedAt
    expect(h.db.navigationItem.deleteMany).toHaveBeenNthCalledWith(1, { where: { id: "c1", parentId: "p1", updatedAt: cAt } });
    expect(h.db.navigationItem.deleteMany).toHaveBeenNthCalledWith(2, { where: { id: "c2", parentId: "p1", updatedAt: cAt } });
    // 부모 CAS where: id+updatedAt
    expect(h.db.navigationItem.deleteMany).toHaveBeenNthCalledWith(3, { where: { id: "p1", updatedAt: pAt } });
    expect(writeAuditMock).toHaveBeenCalledWith(h.db, expect.objectContaining({ action: "delete", entityId: "p1" }));
  });

  it("reparent-away 자식(CAS count 0): 영향행수 불일치 → 롤백, 부모 삭제·audit 미호출", async () => {
    h.db.navigationItem.deleteMany
      .mockResolvedValueOnce({ count: 1 }) // c1 정상
      .mockResolvedValueOnce({ count: 0 }); // c2가 다른 부모로 옮겨감 → CAS 불일치
    await expect(cascadeDelete({
      parentId: "p1", parentUpdatedAt: pAt,
      children: [{ id: "c1", updatedAt: cAt }, { id: "c2", updatedAt: cAt }],
    }, "admin1")).rejects.toBeInstanceOf(NavigationConflictError);
    expect(h.db.navigationItem.deleteMany).toHaveBeenCalledTimes(2); // 부모 삭제까지 가지 않음
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("count 체크 이후 늦게 추가된 자식(부모 삭제 FK 위반 P2003) → Conflict로 변환·롤백", async () => {
    h.db.navigationItem.deleteMany
      .mockResolvedValueOnce({ count: 1 }) // captured child
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("FK", { code: "P2003", clientVersion: "x" })); // parent delete
    await expect(cascadeDelete({
      parentId: "p1", parentUpdatedAt: pAt,
      children: [{ id: "c1", updatedAt: cAt }],
    }, "admin1")).rejects.toBeInstanceOf(NavigationConflictError);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("부모 CAS 충돌(count 0): Conflict", async () => {
    h.db.navigationItem.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 }); // 부모 updatedAt mismatch
    await expect(cascadeDelete({
      parentId: "p1", parentUpdatedAt: pAt,
      children: [{ id: "c1", updatedAt: cAt }],
    }, "admin1")).rejects.toBeInstanceOf(NavigationConflictError);
  });

  it("자식 없는 노드(leaf): 부모만 CAS 삭제 + audit", async () => {
    h.db.navigationItem.deleteMany.mockResolvedValueOnce({ count: 1 });
    await cascadeDelete({ parentId: "p1", parentUpdatedAt: pAt, children: [] }, "admin1");
    expect(h.db.navigationItem.deleteMany).toHaveBeenCalledTimes(1);
    expect(h.db.navigationItem.deleteMany).toHaveBeenCalledWith({ where: { id: "p1", updatedAt: pAt } });
    expect(writeAuditMock).toHaveBeenCalledWith(h.db, expect.objectContaining({ action: "delete" }));
  });
});

describe("reparentItem (F-7)", () => {
  const expectedAt = new Date("2026-06-22T00:00:00Z");

  it("정상 승격(newParentId null): 락 + CAS 이동 + audit", async () => {
    h.db.navigationItem.findUnique.mockResolvedValue({ updatedAt: expectedAt, parentId: "old" });
    h.db.navigationItem.findFirst.mockResolvedValue({ sortOrder: 20 });
    h.db.navigationItem.updateMany.mockResolvedValue({ count: 1 });
    await reparentItem({ id: "a", newParentId: null, expectedUpdatedAt: expectedAt }, "admin1");
    expect(h.db.$executeRaw).toHaveBeenCalled();
    expect(h.db.navigationItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "a", updatedAt: expectedAt }, data: { parentId: null, sortOrder: 30 },
    }));
    expect(writeAuditMock).toHaveBeenCalledWith(h.db, expect.objectContaining({ action: "reparent", entityId: "a" }));
  });

  it("정상 이동(top-level 부모, 무자식): CAS 이동", async () => {
    h.db.navigationItem.findUnique
      .mockResolvedValueOnce({ updatedAt: expectedAt, parentId: null }) // 이동 노드
      .mockResolvedValueOnce({ parentId: null });                        // 대상 부모 top-level
    h.db.navigationItem.count.mockResolvedValue(0);                      // 이동 노드 무자식
    h.db.navigationItem.findFirst.mockResolvedValue(null);
    h.db.navigationItem.updateMany.mockResolvedValue({ count: 1 });
    await reparentItem({ id: "a", newParentId: "b", expectedUpdatedAt: expectedAt }, "admin1");
    expect(h.db.navigationItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { parentId: "b", sortOrder: 10 },
    }));
  });

  it("F-7: 대상 부모가 이미 자식이면(depth 위반) ValidationError(audit 미기록)", async () => {
    h.db.navigationItem.findUnique
      .mockResolvedValueOnce({ updatedAt: expectedAt, parentId: null }) // 이동 노드
      .mockResolvedValueOnce({ parentId: "g1" });                        // 대상 부모가 중메뉴
    await expect(reparentItem({ id: "a", newParentId: "b", expectedUpdatedAt: expectedAt }, "admin1"))
      .rejects.toBeInstanceOf(NavigationValidationError);
    expect(h.db.navigationItem.updateMany).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("F-7: 이동 노드가 자식을 가지면(중메뉴화=depth3) ValidationError", async () => {
    h.db.navigationItem.findUnique
      .mockResolvedValueOnce({ updatedAt: expectedAt, parentId: null }) // 이동 노드
      .mockResolvedValueOnce({ parentId: null });                        // 대상 부모 top-level
    h.db.navigationItem.count.mockResolvedValue(2);                      // 이동 노드가 자식 보유
    await expect(reparentItem({ id: "a", newParentId: "b", expectedUpdatedAt: expectedAt }, "admin1"))
      .rejects.toBeInstanceOf(NavigationValidationError);
    expect(h.db.navigationItem.updateMany).not.toHaveBeenCalled();
  });

  it("자기 자신을 부모로: ValidationError(순환 차단)", async () => {
    await expect(reparentItem({ id: "a", newParentId: "a", expectedUpdatedAt: expectedAt }, "admin1"))
      .rejects.toBeInstanceOf(NavigationValidationError);
  });

  it("stale updatedAt: Conflict", async () => {
    h.db.navigationItem.findUnique.mockResolvedValue({ updatedAt: new Date("2026-06-20T00:00:00Z"), parentId: null });
    await expect(reparentItem({ id: "a", newParentId: null, expectedUpdatedAt: expectedAt }, "admin1"))
      .rejects.toBeInstanceOf(NavigationConflictError);
  });
});
