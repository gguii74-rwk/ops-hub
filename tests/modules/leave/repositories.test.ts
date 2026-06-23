import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted로 fake db를 먼저 선언 — mock factory는 hoisted되므로 동일 객체를 공유해야 함.
const h = vi.hoisted(() => {
  const db = {
    leaveRequest: {
      findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(),
      create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
      delete: vi.fn(), aggregate: vi.fn(),
    },
    leaveAllocation: {
      findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(),
      update: vi.fn(), create: vi.fn(), findMany: vi.fn(),
    },
    leaveAllocationHistory: { create: vi.fn(), findMany: vi.fn() },
    mailDelivery: { create: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    team: { findUnique: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  };
  const prisma = { ...db, $transaction: vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db)) };
  // getEffectiveScope mock — F-O/F-D in-tx 재해석용
  const getEffectiveScopeMock = vi.fn();
  return { db, prisma, getEffectiveScopeMock };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
// outbox insert/cancel·audit는 별도 단위로 검증 — 여기선 호출 여부/인자만 단언한다.
const insertPendingDeliveryMock = vi.fn();
const cancelPendingDeliveriesMock = vi.fn();
const writeAuditMock = vi.fn();
vi.mock("@/modules/leave/repositories/mail", () => ({
  insertPendingDelivery: (...a: unknown[]) => insertPendingDeliveryMock(...a),
  cancelPendingDeliveries: (...a: unknown[]) => cancelPendingDeliveriesMock(...a),
}));
vi.mock("@/kernel/audit", () => ({ writeAudit: (...a: unknown[]) => writeAuditMock(...a) }));
vi.mock("@/kernel/access", () => ({
  getEffectiveScope: (...a: unknown[]) => (h.getEffectiveScopeMock as (...args: unknown[]) => unknown)(...a),
  ForbiddenError: class ForbiddenError extends Error {
    constructor(m = "권한이 없습니다.") { super(m); this.name = "ForbiddenError"; }
  },
}));

import { approveTx, rejectRequest, cancelTx, updateByAdminTx, adjustAllocationTx, findOverlap, createPendingRequest, createApprovedRequestTx, deleteByAdminTx, recalculateUsedDaysTx } from "@/modules/leave/repositories";
import { LeaveConflictError } from "@/modules/leave/errors";
import { ForbiddenError } from "@/kernel/access";

beforeEach(() => {
  vi.clearAllMocks();
  insertPendingDeliveryMock.mockReset();
  cancelPendingDeliveriesMock.mockReset();
  writeAuditMock.mockReset();
});

describe("approveTx", () => {
  const updatedAt = new Date("2026-08-01T00:00:00Z");
  it("PENDING이면 APPROVED + usedDays increment (CAS where에 status+updatedAt)", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1, updatedAt });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 1 });
    await approveTx("r1", "admin1");
    expect(h.db.leaveRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "r1", status: "PENDING", updatedAt },
    }));
    expect(h.db.leaveAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "u1", year: 2026 }, data: { usedDays: { increment: 1 } },
    }));
  });
  it("mailJob 주어지면 APPROVED outbox insert(allocation 증가 이후)", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1, updatedAt });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 1 });
    await approveTx("r1", "admin1", { recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    expect(insertPendingDeliveryMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      leaveRequestId: "r1", eventType: "APPROVED", recipients: ["a@x.com"],
    }));
  });
  it("이미 처리됨이면 LeaveConflictError", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1, updatedAt });
    await expect(approveTx("r1", "admin1")).rejects.toBeInstanceOf(LeaveConflictError);
  });
  it("CAS 충돌(동시 수정 — updateMany count 0)이면 LeaveConflictError, usedDays 미증가", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1, updatedAt });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 0 }); // 그 사이 days/연도 바뀜 → updatedAt mismatch
    await expect(approveTx("r1", "admin1")).rejects.toBeInstanceOf(LeaveConflictError);
    expect(h.db.leaveAllocation.updateMany).not.toHaveBeenCalled();
  });
  it("할당 없으면 LeaveConflictError(증감 0건)", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1, updatedAt });
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
    // 취소 시 큐된 통지도 취소 — stale 메일 차단(soft-delete와 동일).
    expect(cancelPendingDeliveriesMock).toHaveBeenCalledWith(expect.anything(), "r1", expect.any(Date));
  });
  it("PENDING 취소 → CANCELLED, usedDays 변화 없음 + 큐된 통지 취소", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-20T00:00:00Z"), days: 2 });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    await cancelTx("r1", "이유");
    expect(h.db.leaveAllocation.updateMany).not.toHaveBeenCalled();
    expect(cancelPendingDeliveriesMock).toHaveBeenCalledWith(expect.anything(), "r1", expect.any(Date));
  });
});

describe("updateByAdminTx", () => {
  // updatedAt = 클라가 본 버전. CAS where의 updatedAt은 patch.expectedUpdatedAt(서버 재로드 existing.updatedAt 아님 — stale-tab 차단).
  const updatedAt = new Date("2026-07-01T00:00:00Z");
  const patch = {
    adminId: "admin1",
    leaveType: "ANNUAL" as const, leaveSubType: null, quarterStartTime: null,
    startDate: new Date("2027-01-04T00:00:00Z"), endDate: new Date("2027-01-04T00:00:00Z"),
    newDays: 1, reason: null, adminActionNote: null, expectedUpdatedAt: updatedAt,
  };
  // findFirst는 (1) 읽기[deletedAt:null] (2) lockUserAndAssertNoOverlap 두 번 쓰인다 — Once로 읽기, 이후 overlap은 null.
  it("APPROVED 동일연도 수정: CAS where에 status+클라 updatedAt 포함하고 usedDays diff 보정", async () => {
    h.db.leaveRequest.findFirst
      .mockResolvedValueOnce({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-10T00:00:00Z"), days: 1, updatedAt })
      .mockResolvedValue(null);
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 1 });
    h.db.leaveRequest.findUniqueOrThrow.mockResolvedValue({ id: "r1" });
    await updateByAdminTx("r1", { ...patch, startDate: new Date("2026-08-11T00:00:00Z"), endDate: new Date("2026-08-11T00:00:00Z"), newDays: 3 });
    expect(h.db.leaveRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "r1", deletedAt: null, status: "APPROVED", updatedAt }),
    }));
    expect(h.db.leaveAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { usedDays: { increment: 2 } }, // 3 - 1
    }));
  });
  it("CAS 충돌(동시 approve/타 admin 수정 — updateMany count 0)이면 LeaveConflictError, usedDays 미보정", async () => {
    h.db.leaveRequest.findFirst
      .mockResolvedValueOnce({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-10T00:00:00Z"), days: 1, updatedAt })
      .mockResolvedValue(null);
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateByAdminTx("r1", { ...patch, startDate: new Date("2026-08-11T00:00:00Z"), endDate: new Date("2026-08-11T00:00:00Z") })).rejects.toBeInstanceOf(LeaveConflictError);
    expect(h.db.leaveAllocation.updateMany).not.toHaveBeenCalled();
  });
  it("소프트삭제분(findFirst null)이면 LeaveConflictError", async () => {
    h.db.leaveRequest.findFirst.mockResolvedValue(null);
    await expect(updateByAdminTx("r1", patch)).rejects.toBeInstanceOf(LeaveConflictError);
  });
  it("APPROVED 교차연도 수정: 신규연도 할당 없으면 LeaveConflictError(롤백)", async () => {
    h.db.leaveRequest.findFirst
      .mockResolvedValueOnce({ status: "APPROVED", userId: "u1", startDate: new Date("2026-12-31T00:00:00Z"), days: 1, updatedAt })
      .mockResolvedValue(null);
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    h.db.leaveAllocation.updateMany
      .mockResolvedValueOnce({ count: 1 })  // old year(2026) decrement
      .mockResolvedValueOnce({ count: 0 }); // new year(2027) increment → 할당 없음
    await expect(updateByAdminTx("r1", patch)).rejects.toBeInstanceOf(LeaveConflictError);
  });
  it("APPROVED 동일연도 수정: 할당 없으면 LeaveConflictError", async () => {
    h.db.leaveRequest.findFirst
      .mockResolvedValueOnce({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-10T00:00:00Z"), days: 1, updatedAt })
      .mockResolvedValue(null);
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
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
  it("DEDUCT는 원자 increment(절대값 쓰기 아님)로 차감, history는 갱신된 행 기준", async () => {
    h.db.leaveAllocation.findUnique.mockResolvedValue({ id: "a1", allocatedDays: 15, carriedOverDays: 0, usedDays: 5 });
    h.db.leaveAllocation.update.mockResolvedValue({ id: "a1", allocatedDays: 13, carriedOverDays: 0, usedDays: 5 });
    h.db.leaveAllocationHistory.create.mockResolvedValue({ id: "h1" });
    await adjustAllocationTx({ userId: "u1", year: 2026, changeDays: 2, changeType: "DEDUCT", reason: "차감", reasonDetail: null, adminId: "admin1" });
    expect(h.db.leaveAllocation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { allocatedDays: { increment: -2 } } }));
    expect(h.db.leaveAllocationHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ changeType: "DEDUCT", changeDays: 2, beforeDays: 10, afterDays: 8 }),
    }));
  });
  it("증감 결과 allocatedDays가 음수면 LeaveConflictError(롤백)", async () => {
    h.db.leaveAllocation.findUnique.mockResolvedValue({ id: "a1", allocatedDays: 1, carriedOverDays: 0, usedDays: 0 });
    h.db.leaveAllocation.update.mockResolvedValue({ id: "a1", allocatedDays: -1, carriedOverDays: 0, usedDays: 0 });
    await expect(adjustAllocationTx({ userId: "u1", year: 2026, changeDays: 2, changeType: "DEDUCT", reason: "차감", reasonDetail: null, adminId: "admin1" }))
      .rejects.toBeInstanceOf(LeaveConflictError);
  });
});

describe("createPendingRequest", () => {
  const base = {
    userId: "u1", leaveType: "ANNUAL" as const,
    startDate: new Date("2026-08-14T00:00:00Z"), endDate: new Date("2026-08-14T00:00:00Z"), days: 1,
  };
  it("트랜잭션 내에서 advisory lock을 잡고 overlap을 재확인한 뒤 생성", async () => {
    h.db.leaveRequest.findFirst.mockResolvedValue(null);
    h.db.leaveRequest.create.mockResolvedValue({ id: "r1" });
    await createPendingRequest(base);
    expect(h.prisma.$transaction).toHaveBeenCalled();
    expect(h.db.$executeRaw).toHaveBeenCalled();
    expect(h.db.leaveRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: "u1", status: { in: ["PENDING", "APPROVED"] } }),
    }));
    expect(h.db.leaveRequest.create).toHaveBeenCalled();
  });
  it("재확인에서 겹치면 LeaveConflictError(생성 안 함)", async () => {
    h.db.leaveRequest.findFirst.mockResolvedValue({ id: "x" });
    await expect(createPendingRequest(base)).rejects.toBeInstanceOf(LeaveConflictError);
    expect(h.db.leaveRequest.create).not.toHaveBeenCalled();
  });
  it("mailJob 주어지면 tx 내에서 REQUESTED outbox insert", async () => {
    h.db.leaveRequest.findFirst.mockResolvedValue(null);
    h.db.leaveRequest.create.mockResolvedValue({ id: "r1" });
    await createPendingRequest(base, { recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    expect(insertPendingDeliveryMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      leaveRequestId: "r1", eventType: "REQUESTED", recipients: ["a@x.com"],
    }));
  });
  it("mailJob 없으면 outbox insert 미호출", async () => {
    h.db.leaveRequest.findFirst.mockResolvedValue(null);
    h.db.leaveRequest.create.mockResolvedValue({ id: "r1" });
    await createPendingRequest(base);
    expect(insertPendingDeliveryMock).not.toHaveBeenCalled();
  });
});

describe("createApprovedRequestTx", () => {
  const base = {
    userId: "u1", adminId: "admin1", leaveType: "ANNUAL" as const,
    startDate: new Date("2026-08-14T00:00:00Z"), endDate: new Date("2026-08-14T00:00:00Z"),
    days: 1, reason: null,
  };
  it("할당 없으면 LeaveConflictError(증감 0건)", async () => {
    h.db.leaveRequest.findFirst.mockResolvedValue(null);
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 0 });
    await expect(createApprovedRequestTx(base)).rejects.toBeInstanceOf(LeaveConflictError);
  });
  it("tx 내 overlap 재확인에서 겹치면 LeaveConflictError(할당 증가 안 함)", async () => {
    h.db.leaveRequest.findFirst.mockResolvedValue({ id: "x" });
    await expect(createApprovedRequestTx(base)).rejects.toBeInstanceOf(LeaveConflictError);
    expect(h.db.leaveAllocation.updateMany).not.toHaveBeenCalled();
  });
});

describe("deleteByAdminTx (soft-delete)", () => {
  const updatedAt = new Date("2026-07-01T00:00:00Z");
  it("정상 삭제: CAS where(status+updatedAt+deletedAt:null) + data(CANCELLED+deletedAt) + cancelPendingDeliveries(now) + writeAudit", async () => {
    h.db.leaveRequest.findFirst.mockResolvedValue({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1, updatedAt });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 1 });
    await deleteByAdminTx("r1", "admin1", "관리자 삭제");
    const call = h.db.leaveRequest.updateMany.mock.calls[0][0];
    expect(call.where).toEqual(expect.objectContaining({ id: "r1", deletedAt: null, status: "APPROVED", updatedAt }));
    expect(call.data).toEqual(expect.objectContaining({ status: "CANCELLED", deletedByAdminId: "admin1", deleteReason: "관리자 삭제" }));
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(cancelPendingDeliveriesMock).toHaveBeenCalledWith(expect.anything(), "r1", expect.any(Date));
    expect(writeAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorId: "admin1", entityType: "LeaveRequest", entityId: "r1", action: "soft_delete", metadata: { reason: "관리자 삭제" },
    }));
    expect(h.db.leaveRequest.delete).not.toHaveBeenCalled(); // 물리삭제 아님
  });
  it("CAS 충돌(updateMany count 0)이면 LeaveConflictError, usedDays 미보정·cancel/audit 미호출", async () => {
    h.db.leaveRequest.findFirst.mockResolvedValue({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1, updatedAt });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(deleteByAdminTx("r1", "admin1", "사유")).rejects.toBeInstanceOf(LeaveConflictError);
    expect(h.db.leaveAllocation.updateMany).not.toHaveBeenCalled();
    expect(cancelPendingDeliveriesMock).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
  it("이미 삭제분(findFirst null)이면 LeaveConflictError", async () => {
    h.db.leaveRequest.findFirst.mockResolvedValue(null);
    await expect(deleteByAdminTx("r1", "admin1", "사유")).rejects.toBeInstanceOf(LeaveConflictError);
  });
  it("PENDING 삭제는 usedDays 보정 없음(APPROVED만 decrement)", async () => {
    h.db.leaveRequest.findFirst.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1, updatedAt });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    await deleteByAdminTx("r1", "admin1", "사유");
    expect(h.db.leaveAllocation.updateMany).not.toHaveBeenCalled();
    expect(cancelPendingDeliveriesMock).toHaveBeenCalled();
  });
  it("APPROVED 요청 삭제 시 할당 없으면 LeaveConflictError(감소 0건)", async () => {
    h.db.leaveRequest.findFirst.mockResolvedValue({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1, updatedAt });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 0 });
    await expect(deleteByAdminTx("r1", "admin1", "사유")).rejects.toBeInstanceOf(LeaveConflictError);
  });
});

describe("recalculateUsedDaysTx", () => {
  it("할당 없으면 LeaveConflictError(업데이트 0건)", async () => {
    h.db.leaveRequest.aggregate.mockResolvedValue({ _sum: { days: 2 } });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 0 });
    await expect(recalculateUsedDaysTx("u1", 2026)).rejects.toBeInstanceOf(LeaveConflictError);
  });
});

// ─────────────────────────────────────────────
// F-O/F-D/F-P/F-R: approveTx/rejectRequest in-tx 권위 재해석 + 락 순서 불변식
// ─────────────────────────────────────────────

const updatedAt2 = new Date("2026-08-01T00:00:00Z");

function setupHappyPath() {
  // 기본 happy-path: leaveRequest PENDING + allocation ok
  h.db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1, updatedAt: updatedAt2 });
  h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
  h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 1 });
}

describe("approveTx — F-O/F-D in-tx 권위 재해석", () => {
  it("authz 없으면 기존 동작(getEffectiveScope 호출 없음, CAS 진행)", async () => {
    setupHappyPath();
    await approveTx("r1", "admin1");
    expect(h.getEffectiveScopeMock).not.toHaveBeenCalled();
    expect(h.db.leaveRequest.updateMany).toHaveBeenCalled();
  });

  it("F-O: in-tx getEffectiveScope=null(revoke/disable/must-change) → ForbiddenError, status updateMany 미호출", async () => {
    h.getEffectiveScopeMock.mockResolvedValue(null);
    // $queryRaw FOR UPDATE는 호출되어야 함(락 먼저, 그 뒤 scope 재해석)
    h.db.$queryRaw.mockResolvedValue([]);
    await expect(approveTx("r1", "admin1", null, { actorId: "actor1", applicantId: "applicant1" }))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(h.db.leaveRequest.updateMany).not.toHaveBeenCalled();
    expect(insertPendingDeliveryMock).not.toHaveBeenCalled();
  });

  it("F-O: scope=all → 팀 비교 건너뛰고 정상 진행", async () => {
    setupHappyPath();
    h.getEffectiveScopeMock.mockResolvedValue("all");
    h.db.$queryRaw.mockResolvedValue([]);
    await approveTx("r1", "admin1", null, { actorId: "actor1", applicantId: "u1" });
    expect(h.db.leaveRequest.updateMany).toHaveBeenCalled();
  });

  it("F-D: scope=team, actor/applicant 동일팀 → 정상 진행", async () => {
    setupHappyPath();
    h.getEffectiveScopeMock.mockResolvedValue("team");
    // $queryRaw: 1) 락(actor) 2) 락(applicant) 3) SELECT 팀 — 순서대로 응답
    h.db.$queryRaw
      .mockResolvedValueOnce([]) // actor FOR UPDATE
      .mockResolvedValueOnce([]) // applicant FOR UPDATE (sorted)
      .mockResolvedValueOnce([{ id: "actor1", teamId: "teamA" }, { id: "u1", teamId: "teamA" }]) // 팀 조회
      .mockResolvedValueOnce([{ active: true }]); // F-CC: Team active FOR UPDATE
    await approveTx("r1", "admin1", null, { actorId: "actor1", applicantId: "u1" });
    expect(h.db.leaveRequest.updateMany).toHaveBeenCalled();
  });

  it("F-D: scope=team, 신청자 재배정(타 팀) → ForbiddenError, status 미변경", async () => {
    h.getEffectiveScopeMock.mockResolvedValue("team");
    h.db.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "actor1", teamId: "teamA" }, { id: "u1", teamId: "teamB" }]); // 다른 팀
    await expect(approveTx("r1", "admin1", null, { actorId: "actor1", applicantId: "u1" }))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(h.db.leaveRequest.updateMany).not.toHaveBeenCalled();
  });

  it("F-R: scope=team, 같은 팀이지만 팀 비활성 → ForbiddenError", async () => {
    h.getEffectiveScopeMock.mockResolvedValue("team");
    h.db.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "actor1", teamId: "teamA" }, { id: "u1", teamId: "teamA" }])
      .mockResolvedValueOnce([{ active: false }]); // F-CC: 비활성 팀(FOR UPDATE)
    await expect(approveTx("r1", "admin1", null, { actorId: "actor1", applicantId: "u1" }))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(h.db.leaveRequest.updateMany).not.toHaveBeenCalled();
  });

  it("F-CC: scope=team 승인 시 Team 행을 FOR UPDATE로 잠근 뒤 active 확인(동시 비활성화 직렬화)", async () => {
    setupHappyPath();
    h.getEffectiveScopeMock.mockResolvedValue("team");
    const sqls: string[] = [];
    h.db.$queryRaw.mockImplementation((tpl: TemplateStringsArray, ...vals: unknown[]) => {
      void vals;
      const sql = tpl.join("?");
      sqls.push(sql);
      if (/FROM "kernel"\."Team"/.test(sql)) return Promise.resolve([{ active: true }]);
      if (/teamId/.test(sql)) return Promise.resolve([{ id: "actor1", teamId: "teamA" }, { id: "u1", teamId: "teamA" }]);
      return Promise.resolve([]); // User FOR UPDATE 락
    });
    await approveTx("r1", "admin1", null, { actorId: "actor1", applicantId: "u1" });
    const teamLock = sqls.find((s) => /FROM "kernel"\."Team"/.test(s));
    expect(teamLock).toBeDefined();
    expect(teamLock).toMatch(/FOR UPDATE/);
    expect(h.db.leaveRequest.updateMany).toHaveBeenCalled();
  });

  it("F-P: 락 순서 불변식 — actor='zzz', applicant='aaa' → 정렬 순서 aaa,zzz로 $queryRaw FOR UPDATE", async () => {
    setupHappyPath();
    h.getEffectiveScopeMock.mockResolvedValue("all"); // all이면 팀 비교 없이 진행
    const queryRawCalls: string[] = [];
    h.db.$queryRaw.mockImplementation((tpl: TemplateStringsArray, ...vals: unknown[]) => {
      queryRawCalls.push(String(vals[0]));
      return Promise.resolve([]);
    });
    await approveTx("r1", "admin1", null, { actorId: "zzz", applicantId: "aaa" });
    // 정렬 순서: aaa < zzz → 첫 번째 락이 aaa여야 한다
    expect(queryRawCalls[0]).toBe("aaa");
    expect(queryRawCalls[1]).toBe("zzz");
  });
});

describe("rejectRequest — F-O in-tx 권위 재해석", () => {
  it("F-O: in-tx getEffectiveScope=null → ForbiddenError, status updateMany 미호출", async () => {
    h.getEffectiveScopeMock.mockResolvedValue(null);
    h.db.$queryRaw.mockResolvedValue([]);
    await expect(rejectRequest("r1", "admin1", "사유", null, { actorId: "actor1", applicantId: "u1" }))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(h.db.leaveRequest.updateMany).not.toHaveBeenCalled();
    expect(insertPendingDeliveryMock).not.toHaveBeenCalled();
  });

  it("authz 없으면 기존 동작(scope 재해석 없이 CAS 진행)", async () => {
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    await rejectRequest("r1", "admin1", "사유");
    expect(h.getEffectiveScopeMock).not.toHaveBeenCalled();
    expect(h.db.leaveRequest.updateMany).toHaveBeenCalled();
  });

  it("F-P: 락 순서 불변식 — rejectRequest도 정렬 순서로 잠금", async () => {
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    h.getEffectiveScopeMock.mockResolvedValue("all");
    const queryRawCalls: string[] = [];
    h.db.$queryRaw.mockImplementation((tpl: TemplateStringsArray, ...vals: unknown[]) => {
      queryRawCalls.push(String(vals[0]));
      return Promise.resolve([]);
    });
    await rejectRequest("r1", "admin1", "사유", null, { actorId: "zzz", applicantId: "aaa" });
    expect(queryRawCalls[0]).toBe("aaa");
    expect(queryRawCalls[1]).toBe("zzz");
  });

  it("F-CC: scope=team 거절 시 Team 행을 FOR UPDATE로 잠그고 비활성이면 ForbiddenError", async () => {
    h.getEffectiveScopeMock.mockResolvedValue("team");
    h.db.$queryRaw.mockImplementation((tpl: TemplateStringsArray, ...vals: unknown[]) => {
      void vals;
      const sql = tpl.join("?");
      if (/FROM "kernel"\."Team"/.test(sql)) return Promise.resolve([{ active: false }]); // 비활성
      if (/teamId/.test(sql)) return Promise.resolve([{ id: "actor1", teamId: "teamA" }, { id: "u1", teamId: "teamA" }]);
      return Promise.resolve([]);
    });
    await expect(rejectRequest("r1", "admin1", "사유", null, { actorId: "actor1", applicantId: "u1" }))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(h.db.leaveRequest.updateMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// F-S 보상 통제: approveTx/rejectRequest 성공 시 auditLog 기록
// ─────────────────────────────────────────────

describe("approveTx — F-S auditLog 보상 통제", () => {
  const updatedAt3 = new Date("2026-08-01T00:00:00Z");

  it("성공 시 writeAudit(leave.approve) 호출", async () => {
    h.getEffectiveScopeMock.mockResolvedValue("all"); // authz 제공 → in-tx 재해석. all이면 팀 비교 건너뜀(누수 의존 제거)
    h.db.$queryRaw.mockResolvedValue([]);
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1, updatedAt: updatedAt3 });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 1 });
    await approveTx("r1", "admin1", null, { actorId: "admin1", applicantId: "u1" });
    expect(writeAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorId: "admin1",
      entityType: "LeaveRequest",
      entityId: "r1",
      action: "leave.approve",
      metadata: expect.objectContaining({ applicantId: "u1" }),
    }));
  });

  it("authz 없이 성공해도 writeAudit 호출(adminId가 actorId 대체)", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1, updatedAt: updatedAt3 });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    h.db.leaveAllocation.updateMany.mockResolvedValue({ count: 1 });
    await approveTx("r1", "admin1");
    expect(writeAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorId: "admin1",
      entityType: "LeaveRequest",
      entityId: "r1",
      action: "leave.approve",
    }));
  });

  it("F-O: in-tx scope=null(CAS 전 throw) → writeAudit 미호출", async () => {
    h.getEffectiveScopeMock.mockResolvedValue(null);
    h.db.$queryRaw.mockResolvedValue([]);
    await expect(approveTx("r1", "admin1", null, { actorId: "actor1", applicantId: "u1" }))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("CAS 충돌(updateMany count 0) → writeAudit 미호출", async () => {
    h.db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1, updatedAt: updatedAt3 });
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(approveTx("r1", "admin1")).rejects.toBeInstanceOf(LeaveConflictError);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});

describe("rejectRequest — F-S auditLog 보상 통제", () => {
  it("성공 시 writeAudit(leave.reject) 호출", async () => {
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    h.getEffectiveScopeMock.mockResolvedValue("all"); // authz 제공 → in-tx scope 재해석(all → 팀 비교 건너뜀)
    h.db.$queryRaw.mockResolvedValue([]);
    await rejectRequest("r1", "admin1", "사유입니다", null, { actorId: "admin1", applicantId: "u1" });
    expect(writeAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorId: "admin1",
      entityType: "LeaveRequest",
      entityId: "r1",
      action: "leave.reject",
      metadata: expect.objectContaining({ rejectionReason: "사유입니다" }),
    }));
  });

  it("authz 없이 성공해도 writeAudit 호출(adminId가 actorId 대체)", async () => {
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    await rejectRequest("r1", "admin1", "사유");
    expect(writeAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorId: "admin1",
      entityType: "LeaveRequest",
      entityId: "r1",
      action: "leave.reject",
    }));
  });

  it("F-O: in-tx scope=null(CAS 전 throw) → writeAudit 미호출", async () => {
    h.getEffectiveScopeMock.mockResolvedValue(null);
    h.db.$queryRaw.mockResolvedValue([]);
    await expect(rejectRequest("r1", "admin1", "사유", null, { actorId: "actor1", applicantId: "u1" }))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("CAS 충돌(updateMany count 0) → writeAudit 미호출", async () => {
    h.db.leaveRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(rejectRequest("r1", "admin1", "사유")).rejects.toBeInstanceOf(LeaveConflictError);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});
