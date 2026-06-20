import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted로 fake db를 먼저 선언 — mock factory는 hoisted되므로 동일 객체를 공유해야 함.
const h = vi.hoisted(() => {
  const db = {
    leaveRequest: {
      findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(),
      create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
      delete: vi.fn(), aggregate: vi.fn(),
    },
    leaveAllocation: {
      findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(),
      update: vi.fn(), create: vi.fn(), findMany: vi.fn(),
    },
    leaveAllocationHistory: { create: vi.fn(), findMany: vi.fn() },
  };
  const prisma = { ...db, $transaction: vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db)) };
  return { db, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { approveTx, cancelTx, updateByAdminTx, adjustAllocationTx, findOverlap, createApprovedRequestTx, deleteByAdminTx, recalculateUsedDaysTx } from "@/modules/leave/repositories";
import { LeaveConflictError } from "@/modules/leave/errors";

beforeEach(() => { vi.clearAllMocks(); });

describe("approveTx", () => {
  it("PENDING이면 APPROVED + usedDays increment", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1 });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 1 });
    await approveTx("r1", "admin1");
    expect(h.db.leaveAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "u1", year: 2026 }, data: { usedDays: { increment: 1 } },
    }));
  });
  it("이미 처리됨이면 LeaveConflictError", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1 });
    await expect(approveTx("r1", "admin1")).rejects.toBeInstanceOf(LeaveConflictError);
  });
  it("할당 없으면 LeaveConflictError(증감 0건)", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1 });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 0 });
    await expect(approveTx("r1", "admin1")).rejects.toBeInstanceOf(LeaveConflictError);
  });
});

describe("cancelTx", () => {
  it("APPROVED 취소 → CANCELLED + usedDays decrement", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-20T00:00:00Z"), days: 2 });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 1 });
    await cancelTx("r1", "이유");
    expect(h.db.leaveAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { usedDays: { decrement: 2 } },
    }));
  });
  it("PENDING 취소 → CANCELLED, usedDays 변화 없음", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-20T00:00:00Z"), days: 2 });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    await cancelTx("r1", "이유");
    expect(h.db.leaveAllocation.updateMany).not.toHaveBeenCalled();
  });
});

describe("updateByAdminTx", () => {
  const patch = {
    leaveType: "ANNUAL" as const, leaveSubType: null, quarterStartTime: null,
    startDate: new Date("2027-01-04T00:00:00Z"), endDate: new Date("2027-01-04T00:00:00Z"),
    newDays: 1, reason: null, adminActionNote: null,
  };
  it("APPROVED 교차연도 수정: 신규연도 할당 없으면 LeaveConflictError(롤백)", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "APPROVED", userId: "u1", startDate: new Date("2026-12-31T00:00:00Z"), days: 1 });
    h.db.leaveRequest.update.mockResolvedValue({ id: "r1" });
    h.db.leaveAllocation.updateMany
      .mockResolvedValueOnce({ count: 1 })  // old year(2026) decrement
      .mockResolvedValueOnce({ count: 0 }); // new year(2027) increment → 할당 없음
    await expect(updateByAdminTx("r1", patch)).rejects.toBeInstanceOf(LeaveConflictError);
  });
  it("APPROVED 동일연도 수정: 할당 없으면 LeaveConflictError", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-10T00:00:00Z"), days: 1 });
    h.db.leaveRequest.update.mockResolvedValue({ id: "r1" });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateByAdminTx("r1", { ...patch, startDate: new Date("2026-08-11T00:00:00Z"), endDate: new Date("2026-08-11T00:00:00Z") })).rejects.toBeInstanceOf(LeaveConflictError);
  });
});

describe("findOverlap", () => {
  it("PENDING/APPROVED 겹침 쿼리", async () => {
    h.db.leaveRequest.findFirst.mockResolvedValue(null);
    await findOverlap("u1", new Date("2026-08-14T00:00:00Z"), new Date("2026-08-15T00:00:00Z"));
    expect(h.db.leaveRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: "u1", status: { in: ["PENDING", "APPROVED"] } }),
    }));
  });
});

describe("adjustAllocationTx", () => {
  it("DEDUCT는 양수 크기를 차감(부호는 changeType), history는 양수로 기록", async () => {
    h.db.leaveAllocation.findUnique.mockResolvedValue({ id: "a1", allocatedDays: 15, carriedOverDays: 0, usedDays: 5 });
    h.db.leaveAllocation.update.mockResolvedValue({ id: "a1" });
    h.db.leaveAllocationHistory.create.mockResolvedValue({ id: "h1" });
    await adjustAllocationTx({ userId: "u1", year: 2026, changeDays: 2, changeType: "DEDUCT", reason: "차감", reasonDetail: null, adminId: "admin1" });
    expect(h.db.leaveAllocation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { allocatedDays: 13 } }));
    expect(h.db.leaveAllocationHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ changeType: "DEDUCT", changeDays: 2, beforeDays: 10, afterDays: 8 }),
    }));
  });
});

describe("createApprovedRequestTx", () => {
  it("할당 없으면 LeaveConflictError(증감 0건)", async () => {
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 0 });
    await expect(createApprovedRequestTx({
      userId: "u1", adminId: "admin1", leaveType: "ANNUAL",
      startDate: new Date("2026-08-14T00:00:00Z"), endDate: new Date("2026-08-14T00:00:00Z"),
      days: 1, reason: null,
    })).rejects.toBeInstanceOf(LeaveConflictError);
  });
});

describe("deleteByAdminTx", () => {
  it("APPROVED 요청 삭제 시 할당 없으면 LeaveConflictError(감소 0건)", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1 });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 0 });
    await expect(deleteByAdminTx("r1")).rejects.toBeInstanceOf(LeaveConflictError);
  });
});

describe("recalculateUsedDaysTx", () => {
  it("할당 없으면 LeaveConflictError(업데이트 0건)", async () => {
    h.db.leaveRequest.aggregate.mockResolvedValue({ _sum: { days: 2 } });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 0 });
    await expect(recalculateUsedDaysTx("u1", 2026)).rejects.toBeInstanceOf(LeaveConflictError);
  });
});
