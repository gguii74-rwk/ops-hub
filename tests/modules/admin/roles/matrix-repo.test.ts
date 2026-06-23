import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
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
  h.tx.$executeRaw.mockResolvedValue(1);
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
  // F-BB: 같은 셀 동시 편집 직렬화 — 셀 단위 advisory lock을 deleteMany보다 먼저 잡는다.
  it("F-BB: 셀 advisory lock을 deleteMany 전에 셀 키로 잡는다", async () => {
    h.tx.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: false });
    const order: string[] = [];
    h.tx.$executeRaw.mockImplementation(() => { order.push("lock"); return Promise.resolve(1); });
    h.tx.rolePermission.deleteMany.mockImplementation(() => { order.push("delete"); return Promise.resolve({ count: 0 }); });
    await setCell("r1", "p1", "ALLOW", "all", "actor");
    expect(h.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(order.indexOf("lock")).toBeLessThan(order.indexOf("delete")); // 락이 삭제보다 먼저
    // advisory lock 키에 (roleId,permissionId) 셀이 포함되는지(서로 다른 셀은 직렬화하지 않음)
    expect(h.tx.$executeRaw.mock.calls[0]).toContain("r1:p1");
  });
  // F-H: status/mustChangePassword 분기 — OWNER여도 비활성·임시비번 상태면 거부
  it("F-H: in-tx actor가 OWNER·DISABLED → ForbiddenError, 셀/감사 미기록", async () => {
    h.tx.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "DISABLED", mustChangePassword: false });
    await expect(setCell("r1", "p1", "ALLOW", "all", "actor")).rejects.toBeInstanceOf(ForbiddenError);
    expect(h.tx.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(h.tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("F-H: in-tx actor가 OWNER·ACTIVE·mustChangePassword=true → ForbiddenError, 셀/감사 미기록", async () => {
    h.tx.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: true });
    await expect(setCell("r1", "p1", "ALLOW", "all", "actor")).rejects.toBeInstanceOf(ForbiddenError);
    expect(h.tx.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(h.tx.auditLog.create).not.toHaveBeenCalled();
  });
});
