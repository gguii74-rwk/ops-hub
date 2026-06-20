import "server-only";
import type { LeaveRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { LeaveConflictError } from "../errors";

// ── 조회 ──

export function getRequestById(id: string) {
  return prisma.leaveRequest.findUnique({ where: { id } });
}

export function listRequests(filter: { userId?: string; statuses?: LeaveRequestStatus[] }) {
  return prisma.leaveRequest.findMany({
    where: {
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export function findActiveAllocation(userId: string, year: number) {
  return prisma.leaveAllocation.findUnique({ where: { userId_year: { userId, year } } });
}

export async function sumPendingDays(userId: string, year: number): Promise<number> {
  const res = await prisma.leaveRequest.aggregate({
    where: {
      userId, status: "PENDING",
      startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
    },
    _sum: { days: true },
  });
  return res._sum.days ? Number(res._sum.days) : 0;
}

export function findOverlap(userId: string, start: Date, end: Date, excludeId?: string) {
  return prisma.leaveRequest.findFirst({
    where: {
      userId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      status: { in: ["PENDING", "APPROVED"] },
      AND: [{ startDate: { lte: end } }, { endDate: { gte: start } }],
    },
  });
}

// ── 생성 ──

export function createPendingRequest(data: {
  userId: string; leaveType: "ANNUAL" | "HALF" | "QUARTER";
  leaveSubType?: "MORNING" | "AFTERNOON" | null; quarterStartTime?: string | null;
  startDate: Date; endDate: Date; days: number; reason?: string | null;
}) {
  return prisma.leaveRequest.create({
    data: {
      userId: data.userId, leaveType: data.leaveType,
      leaveSubType: data.leaveType === "HALF" ? data.leaveSubType ?? null : null,
      quarterStartTime: data.leaveType === "QUARTER" ? data.quarterStartTime ?? null : null,
      startDate: data.startDate, endDate: data.endDate, days: data.days,
      reason: data.reason ?? null, status: "PENDING",
    },
  });
}

// 관리자 직접입력 — 자동 APPROVED + usedDays increment(원자).
export async function createApprovedRequestTx(data: {
  userId: string; adminId: string; leaveType: "ANNUAL" | "HALF" | "QUARTER";
  leaveSubType?: "MORNING" | "AFTERNOON" | null; quarterStartTime?: string | null;
  startDate: Date; endDate: Date; days: number; reason?: string | null; adminActionNote?: string | null;
}) {
  const year = data.startDate.getUTCFullYear();
  return prisma.$transaction(async (tx) => {
    const alloc = await tx.leaveAllocation.updateMany({
      where: { userId: data.userId, year }, data: { usedDays: { increment: data.days } },
    });
    if (alloc.count === 0) throw new LeaveConflictError(`${year}년도 연차 할당 정보가 없습니다.`);
    return tx.leaveRequest.create({
      data: {
        userId: data.userId, leaveType: data.leaveType,
        leaveSubType: data.leaveType === "HALF" ? data.leaveSubType ?? null : null,
        quarterStartTime: data.leaveType === "QUARTER" ? data.quarterStartTime ?? null : null,
        startDate: data.startDate, endDate: data.endDate, days: data.days, reason: data.reason ?? null,
        status: "APPROVED", reviewedById: data.adminId, reviewedAt: new Date(),
        adminActionNote: data.adminActionNote ?? "관리자 직접입력",
      },
    });
  });
}

// ── 전이 tx (상태 가드 + 원자 증감) ──

export async function approveTx(requestId: string, adminId: string) {
  await prisma.$transaction(async (tx) => {
    const req = await tx.leaveRequest.findUnique({
      where: { id: requestId }, select: { status: true, userId: true, startDate: true, days: true },
    });
    if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    if (req.status !== "PENDING") throw new LeaveConflictError("이미 처리된 신청입니다.");
    const updated = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: "APPROVED", reviewedById: adminId, reviewedAt: new Date() },
    });
    if (updated.count === 0) throw new LeaveConflictError("이미 처리된 신청입니다.");
    const alloc = await tx.leaveAllocation.updateMany({
      where: { userId: req.userId, year: req.startDate.getUTCFullYear() },
      data: { usedDays: { increment: req.days } },
    });
    if (alloc.count === 0) throw new LeaveConflictError("연차 할당 정보를 찾을 수 없습니다.");
  });
}

export async function rejectRequest(requestId: string, adminId: string, rejectionReason: string) {
  const updated = await prisma.leaveRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: { status: "REJECTED", reviewedById: adminId, reviewedAt: new Date(), rejectionReason },
  });
  if (updated.count === 0) throw new LeaveConflictError("이미 처리된 신청입니다.");
}

// 취소 — CANCELLED + (APPROVED였으면) usedDays decrement.
export async function cancelTx(requestId: string, cancellationReason: string | null) {
  await prisma.$transaction(async (tx) => {
    const req = await tx.leaveRequest.findUnique({
      where: { id: requestId }, select: { status: true, userId: true, startDate: true, days: true },
    });
    if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    if (req.status !== "PENDING" && req.status !== "APPROVED") throw new LeaveConflictError("취소할 수 없는 상태입니다.");
    const wasApproved = req.status === "APPROVED";
    const updated = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: req.status },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason },
    });
    if (updated.count === 0) throw new LeaveConflictError("상태가 이미 변경되었습니다.");
    if (wasApproved) {
      const r = await tx.leaveAllocation.updateMany({
        where: { userId: req.userId, year: req.startDate.getUTCFullYear() },
        data: { usedDays: { decrement: req.days } },
      });
      if (r.count === 0) throw new LeaveConflictError("연차 할당 정보를 찾을 수 없습니다.");
    }
  });
}

// 관리자 수정 — days 재계산 결과를 받아 같은/교차 연도 usedDays 보정.
export async function updateByAdminTx(requestId: string, patch: {
  leaveType: "ANNUAL" | "HALF" | "QUARTER"; leaveSubType: "MORNING" | "AFTERNOON" | null;
  quarterStartTime: string | null; startDate: Date; endDate: Date; newDays: number;
  reason: string | null; adminActionNote: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.leaveRequest.findUnique({
      where: { id: requestId }, select: { status: true, userId: true, startDate: true, days: true },
    });
    if (!existing) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    const updated = await tx.leaveRequest.update({
      where: { id: requestId },
      data: {
        leaveType: patch.leaveType,
        leaveSubType: patch.leaveType === "HALF" ? patch.leaveSubType : null,
        quarterStartTime: patch.leaveType === "QUARTER" ? patch.quarterStartTime : null,
        startDate: patch.startDate, endDate: patch.endDate, days: patch.newDays,
        reason: patch.reason, adminActionNote: patch.adminActionNote ?? "관리자 수정",
      },
    });
    if (existing.status === "APPROVED") {
      const oldYear = existing.startDate.getUTCFullYear();
      const newYear = patch.startDate.getUTCFullYear();
      if (oldYear === newYear) {
        const diff = patch.newDays - Number(existing.days);
        const r = await tx.leaveAllocation.updateMany({
          where: { userId: existing.userId, year: oldYear },
          data: { usedDays: { increment: diff } },
        });
        if (r.count === 0) throw new LeaveConflictError(`${oldYear}년도 연차 할당 정보가 없습니다.`);
      } else {
        const rOld = await tx.leaveAllocation.updateMany({
          where: { userId: existing.userId, year: oldYear },
          data: { usedDays: { decrement: existing.days } },
        });
        if (rOld.count === 0) throw new LeaveConflictError(`${oldYear}년도 연차 할당 정보가 없습니다.`);
        const rNew = await tx.leaveAllocation.updateMany({
          where: { userId: existing.userId, year: newYear },
          data: { usedDays: { increment: patch.newDays } },
        });
        if (rNew.count === 0) throw new LeaveConflictError(`${newYear}년도 연차 할당 정보가 없습니다.`);
      }
    }
    return updated;
  });
}

export async function deleteByAdminTx(requestId: string) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.leaveRequest.findUnique({
      where: { id: requestId }, select: { status: true, userId: true, startDate: true, days: true },
    });
    if (!existing) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    if (existing.status === "APPROVED") {
      const r = await tx.leaveAllocation.updateMany({
        where: { userId: existing.userId, year: existing.startDate.getUTCFullYear() },
        data: { usedDays: { decrement: existing.days } },
      });
      if (r.count === 0) throw new LeaveConflictError("연차 할당 정보를 찾을 수 없습니다.");
    }
    await tx.leaveRequest.delete({ where: { id: requestId } });
  });
}

// ── 할당 ──

export function upsertAllocation(userId: string, year: number, data: {
  allocatedDays: number; carriedOverDays: number; carriedOverExpiryDate: Date | null;
}) {
  return prisma.leaveAllocation.upsert({
    where: { userId_year: { userId, year } },
    update: {
      allocatedDays: data.allocatedDays,
      carriedOverDays: data.carriedOverDays,
      carriedOverExpiryDate: data.carriedOverExpiryDate,
    },
    create: {
      userId, year,
      allocatedDays: data.allocatedDays,
      carriedOverDays: data.carriedOverDays,
      carriedOverExpiryDate: data.carriedOverExpiryDate,
    },
  });
}

// 조정 — allocatedDays 증감 + 이력. before/after = 조정 전/후 잔여(total - used).
export async function adjustAllocationTx(input: {
  userId: string; year: number; changeDays: number; changeType: "ADD" | "DEDUCT";
  reason: string; reasonDetail: string | null; adminId: string;
}) {
  // changeDays는 양수 크기, 부호는 changeType이 결정(ADD=+, DEDUCT=-).
  const delta = input.changeType === "DEDUCT" ? -input.changeDays : input.changeDays;
  return prisma.$transaction(async (tx) => {
    let alloc = await tx.leaveAllocation.findUnique({
      where: { userId_year: { userId: input.userId, year: input.year } },
    });
    if (!alloc) {
      alloc = await tx.leaveAllocation.create({
        data: { userId: input.userId, year: input.year, allocatedDays: 0, carriedOverDays: 0, usedDays: 0 },
      });
    }
    const total = Number(alloc.allocatedDays) + Number(alloc.carriedOverDays);
    const beforeDays = total - Number(alloc.usedDays);
    const newAllocated = Number(alloc.allocatedDays) + delta;
    if (newAllocated < 0) throw new LeaveConflictError("할당 연차가 음수가 될 수 없습니다.");
    const afterDays = beforeDays + delta;
    const updated = await tx.leaveAllocation.update({
      where: { userId_year: { userId: input.userId, year: input.year } },
      data: { allocatedDays: newAllocated },
    });
    const history = await tx.leaveAllocationHistory.create({
      data: {
        allocationId: alloc.id, userId: input.userId, changeType: input.changeType,
        changeDays: input.changeDays, reason: input.reason,
        reasonDetail: input.reasonDetail ?? null,
        beforeDays, afterDays, createdById: input.adminId,
      },
    });
    return { allocation: updated, history };
  });
}

export function listAllocations(year: number) {
  return prisma.leaveAllocation.findMany({ where: { year }, orderBy: { userId: "asc" } });
}

export function getAllocationHistory(userId: string, year?: number) {
  return prisma.leaveAllocationHistory.findMany({
    where: { userId, ...(year ? { allocation: { year } } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

// usedDays 재계산 — 해당 연도 APPROVED 합계로 확정(정합성 복구).
export async function recalculateUsedDaysTx(userId: string, year: number): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.leaveRequest.aggregate({
      where: {
        userId, status: "APPROVED",
        startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
      },
      _sum: { days: true },
    });
    const used = res._sum.days ? Number(res._sum.days) : 0;
    const r = await tx.leaveAllocation.updateMany({ where: { userId, year }, data: { usedDays: used } });
    if (r.count === 0) throw new LeaveConflictError(`${year}년도 연차 할당 정보가 없습니다.`);
    return used;
  });
}
