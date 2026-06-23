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
