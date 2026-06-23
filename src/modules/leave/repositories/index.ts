import "server-only";
import type { LeaveRequestStatus, Prisma } from "@prisma/client";
import { ForbiddenError, getEffectiveScope } from "@/kernel/access";
import { prisma } from "@/lib/prisma";
import { LeaveConflictError } from "../errors";
import { insertPendingDelivery, cancelPendingDeliveries, type MailJob } from "./mail";
import { writeAudit } from "@/kernel/audit";

export type ApprovalAuthz = { actorId: string; applicantId: string };

// ── 조회 ──

export function getRequestById(id: string) {
  return prisma.leaveRequest.findFirst({ where: { id, deletedAt: null } });
}

export function listRequests(filter: { userId?: string; statuses?: LeaveRequestStatus[] }) {
  return prisma.leaveRequest.findMany({
    where: {
      deletedAt: null,
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

const overlapWhere = (userId: string, start: Date, end: Date, excludeId?: string) => ({
  userId,
  ...(excludeId ? { id: { not: excludeId } } : {}),
  status: { in: ["PENDING", "APPROVED"] as LeaveRequestStatus[] },
  AND: [{ startDate: { lte: end } }, { endDate: { gte: start } }],
});

export function findOverlap(userId: string, start: Date, end: Date, excludeId?: string) {
  return prisma.leaveRequest.findFirst({ where: overlapWhere(userId, start, end, excludeId) });
}

// leave 도메인 advisory lock 네임스페이스 — 다른 advisory lock 사용처와 키 충돌 방지.
const LEAVE_OVERLAP_LOCK_NS = 0x6c76; // 'lv'

// 동시 신청의 TOCTOU 이중 등록 방지: 사용자 단위 advisory xact lock으로 직렬화한 뒤 같은 트랜잭션에서 overlap 재확인.
// 서비스 계층의 사전 findOverlap은 빠른 실패용일 뿐, 권위 있는 검사는 여기(쓰기 트랜잭션 내부)다.
async function lockUserAndAssertNoOverlap(
  tx: Prisma.TransactionClient, userId: string, start: Date, end: Date, excludeId?: string,
) {
  // pg_advisory_xact_lock은 void 반환 → $queryRaw는 P2010(void 역직렬화) 실패. 실행만 하는 $executeRaw 사용.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LEAVE_OVERLAP_LOCK_NS}::int4, hashtext(${userId}))`;
  const overlap = await tx.leaveRequest.findFirst({ where: overlapWhere(userId, start, end, excludeId) });
  if (overlap) throw new LeaveConflictError("해당 기간에 이미 신청된 연차가 있습니다.");
}

// ── 생성 ──

export function createPendingRequest(data: {
  userId: string; leaveType: "ANNUAL" | "HALF" | "QUARTER";
  leaveSubType?: "MORNING" | "AFTERNOON" | null; quarterStartTime?: string | null;
  startDate: Date; endDate: Date; days: number; reason?: string | null;
}, mailJob?: MailJob | null) {
  return prisma.$transaction(async (tx) => {
    await lockUserAndAssertNoOverlap(tx, data.userId, data.startDate, data.endDate);
    const req = await tx.leaveRequest.create({
      data: {
        userId: data.userId, leaveType: data.leaveType,
        leaveSubType: data.leaveType === "HALF" ? data.leaveSubType ?? null : null,
        quarterStartTime: data.leaveType === "QUARTER" ? data.quarterStartTime ?? null : null,
        startDate: data.startDate, endDate: data.endDate, days: data.days,
        reason: data.reason ?? null, status: "PENDING",
      },
    });
    if (mailJob) await insertPendingDelivery(tx, { leaveRequestId: req.id, eventType: "REQUESTED", ...mailJob });
    return req;
  });
}

// 관리자 직접입력 — 자동 APPROVED + usedDays increment(원자).
export async function createApprovedRequestTx(data: {
  userId: string; adminId: string; leaveType: "ANNUAL" | "HALF" | "QUARTER";
  leaveSubType?: "MORNING" | "AFTERNOON" | null; quarterStartTime?: string | null;
  startDate: Date; endDate: Date; days: number; reason?: string | null; adminActionNote?: string | null;
}, mailJob?: MailJob | null) {
  const year = data.startDate.getUTCFullYear();
  return prisma.$transaction(async (tx) => {
    await lockUserAndAssertNoOverlap(tx, data.userId, data.startDate, data.endDate);
    const alloc = await tx.leaveAllocation.updateMany({
      where: { userId: data.userId, year }, data: { usedDays: { increment: data.days } },
    });
    if (alloc.count === 0) throw new LeaveConflictError(`${year}년도 연차 할당 정보가 없습니다.`);
    const created = await tx.leaveRequest.create({
      data: {
        userId: data.userId, leaveType: data.leaveType,
        leaveSubType: data.leaveType === "HALF" ? data.leaveSubType ?? null : null,
        quarterStartTime: data.leaveType === "QUARTER" ? data.quarterStartTime ?? null : null,
        startDate: data.startDate, endDate: data.endDate, days: data.days, reason: data.reason ?? null,
        status: "APPROVED", reviewedById: data.adminId, reviewedAt: new Date(),
        createdByAdminId: data.adminId, createdByAdminAt: new Date(),
        adminActionNote: data.adminActionNote ?? "관리자 직접입력",
      },
    });
    if (mailJob) await insertPendingDelivery(tx, { leaveRequestId: created.id, eventType: "ADMIN_CREATED", ...mailJob });
    return created;
  });
}

// ── 전이 tx (상태 가드 + 원자 증감) ──

export async function approveTx(requestId: string, adminId: string, mailJob?: MailJob | null, authz?: ApprovalAuthz) {
  await prisma.$transaction(async (tx) => {
    // F-P: lock actor+applicant in sorted order(데드락 방지)
    if (authz) {
      const lockIds = [...new Set([authz.actorId, authz.applicantId])].sort();
      for (const uid of lockIds) {
        await tx.$queryRaw`SELECT 1 FROM "kernel"."User" WHERE "id" = ${uid} FOR UPDATE`;
      }
      // F-O: re-resolve scope in-tx(권한이 claim~발송 사이 변경됐을 때 fail-closed)
      const scope = await getEffectiveScope(authz.actorId, "leave.approval", "approve", tx);
      if (scope == null) throw new ForbiddenError("승인 권한이 없습니다.");
      if (scope === "team") {
        const rows = await tx.$queryRaw<Array<{ id: string; teamId: string | null }>>`
          SELECT "id", "teamId" FROM "kernel"."User" WHERE "id" IN (${authz.actorId}, ${authz.applicantId})`;
        const actorTeam = rows.find((r) => r.id === authz.actorId)?.teamId ?? null;
        const applicantTeam = rows.find((r) => r.id === authz.applicantId)?.teamId ?? null;
        if (actorTeam == null || actorTeam !== applicantTeam) {
          throw new ForbiddenError("해당 신청에 대한 승인 권한이 없습니다.");
        }
        // F-R: inactive team
        const team = await tx.team.findUnique({ where: { id: actorTeam }, select: { active: true } });
        if (!team?.active) throw new ForbiddenError("비활성 팀에서는 team-scope 승인을 할 수 없습니다.");
      }
    }
    // updatedAt을 함께 읽어 CAS where에 건다 — PENDING 신청을 admin이 수정(days/연도 변경)할 수 있으므로
    // status-only CAS만으론 stale days로 usedDays가 증가할 수 있다(balance drift). updatedAt 낙관락이 막는다.
    const req = await tx.leaveRequest.findUnique({
      where: { id: requestId }, select: { status: true, userId: true, startDate: true, days: true, updatedAt: true },
    });
    if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    if (req.status !== "PENDING") throw new LeaveConflictError("이미 처리된 신청입니다.");
    const updated = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: "PENDING", updatedAt: req.updatedAt },
      data: { status: "APPROVED", reviewedById: adminId, reviewedAt: new Date() },
    });
    if (updated.count === 0) throw new LeaveConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
    const alloc = await tx.leaveAllocation.updateMany({
      where: { userId: req.userId, year: req.startDate.getUTCFullYear() },
      data: { usedDays: { increment: req.days } },
    });
    if (alloc.count === 0) throw new LeaveConflictError("연차 할당 정보를 찾을 수 없습니다.");
    if (mailJob) await insertPendingDelivery(tx, { leaveRequestId: requestId, eventType: "APPROVED", ...mailJob });
  });
}

export async function rejectRequest(requestId: string, adminId: string, rejectionReason: string, mailJob?: MailJob | null, authz?: ApprovalAuthz) {
  await prisma.$transaction(async (tx) => {
    // F-P: lock actor+applicant in sorted order(데드락 방지)
    if (authz) {
      const lockIds = [...new Set([authz.actorId, authz.applicantId])].sort();
      for (const uid of lockIds) {
        await tx.$queryRaw`SELECT 1 FROM "kernel"."User" WHERE "id" = ${uid} FOR UPDATE`;
      }
      // F-O: re-resolve scope in-tx
      const scope = await getEffectiveScope(authz.actorId, "leave.approval", "approve", tx);
      if (scope == null) throw new ForbiddenError("승인 권한이 없습니다.");
      if (scope === "team") {
        const rows = await tx.$queryRaw<Array<{ id: string; teamId: string | null }>>`
          SELECT "id", "teamId" FROM "kernel"."User" WHERE "id" IN (${authz.actorId}, ${authz.applicantId})`;
        const actorTeam = rows.find((r) => r.id === authz.actorId)?.teamId ?? null;
        const applicantTeam = rows.find((r) => r.id === authz.applicantId)?.teamId ?? null;
        if (actorTeam == null || actorTeam !== applicantTeam) {
          throw new ForbiddenError("해당 신청에 대한 승인 권한이 없습니다.");
        }
        // F-R: inactive team
        const team = await tx.team.findUnique({ where: { id: actorTeam }, select: { active: true } });
        if (!team?.active) throw new ForbiddenError("비활성 팀에서는 team-scope 승인을 할 수 없습니다.");
      }
    }
    const updated = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: "REJECTED", reviewedById: adminId, reviewedAt: new Date(), rejectionReason },
    });
    if (updated.count === 0) throw new LeaveConflictError("이미 처리된 신청입니다.");
    if (mailJob) await insertPendingDelivery(tx, { leaveRequestId: requestId, eventType: "REJECTED", ...mailJob });
  });
}

// 취소 — CANCELLED + (APPROVED였으면) usedDays decrement.
export async function cancelTx(requestId: string, cancellationReason: string | null) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const req = await tx.leaveRequest.findUnique({
      where: { id: requestId }, select: { status: true, userId: true, startDate: true, days: true },
    });
    if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    if (req.status !== "PENDING" && req.status !== "APPROVED") throw new LeaveConflictError("취소할 수 없는 상태입니다.");
    const wasApproved = req.status === "APPROVED";
    const updated = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: req.status },
      data: { status: "CANCELLED", cancelledAt: now, cancellationReason },
    });
    if (updated.count === 0) throw new LeaveConflictError("상태가 이미 변경되었습니다.");
    if (wasApproved) {
      const r = await tx.leaveAllocation.updateMany({
        where: { userId: req.userId, year: req.startDate.getUTCFullYear() },
        data: { usedDays: { decrement: req.days } },
      });
      if (r.count === 0) throw new LeaveConflictError("연차 할당 정보를 찾을 수 없습니다.");
    }
    // 큐된 통지(REQUESTED/APPROVED) 취소 — 취소된 신청의 stale 메일 발송 차단(soft-delete deleteByAdminTx와 동일 패턴).
    // active SENDING은 건드리지 않음(결정 A); drain도 발송 직전 status를 재확인해 잔여 윈도를 막는다.
    await cancelPendingDeliveries(tx, requestId, now);
  });
}

// 관리자 수정 — days 재계산 결과를 받아 같은/교차 연도 usedDays 보정.
export async function updateByAdminTx(requestId: string, patch: {
  adminId: string; leaveType: "ANNUAL" | "HALF" | "QUARTER"; leaveSubType: "MORNING" | "AFTERNOON" | null;
  quarterStartTime: string | null; startDate: Date; endDate: Date; newDays: number;
  reason: string | null; adminActionNote: string | null; expectedUpdatedAt: Date;
}) {
  return prisma.$transaction(async (tx) => {
    // 소프트삭제 제외. existing은 status·userId·startDate·days 재계산/연도 보정에 계속 쓴다(CAS 버전은 클라가 본 값).
    const existing = await tx.leaveRequest.findFirst({
      where: { id: requestId, deletedAt: null }, select: { status: true, userId: true, startDate: true, days: true },
    });
    if (!existing) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    await lockUserAndAssertNoOverlap(tx, existing.userId, patch.startDate, patch.endDate, requestId);
    // 본문 전이는 CAS updateMany — 관찰한 status·미삭제 + 클라가 본 updatedAt일 때만. 0행이면 그 사이 approve/cancel/타 admin 수정/삭제됨
    // → 충돌로 막아 usedDays 정합성 보호(read-then-update race + days-ABA 방지). CAS의 updatedAt은 클라가 본 버전(patch.expectedUpdatedAt) —
    // 서버 재로드값이 아니라 모달을 열어둔 사이의 stale-tab lost-update까지 막는다(@updatedAt이 status 불변·days만 바뀐 수정도 잡는다).
    const transition = await tx.leaveRequest.updateMany({
      where: { id: requestId, deletedAt: null, status: existing.status, updatedAt: patch.expectedUpdatedAt },
      data: {
        leaveType: patch.leaveType,
        leaveSubType: patch.leaveType === "HALF" ? patch.leaveSubType : null,
        quarterStartTime: patch.leaveType === "QUARTER" ? patch.quarterStartTime : null,
        startDate: patch.startDate, endDate: patch.endDate, days: patch.newDays,
        reason: patch.reason, adminActionNote: patch.adminActionNote ?? "관리자 수정",
        modifiedByAdminId: patch.adminId, modifiedByAdminAt: new Date(),
      },
    });
    if (transition.count === 0) throw new LeaveConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
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
    return tx.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
  });
}

// 관리자 삭제 = soft-delete(deletedAt+감사). 물리삭제 아님. status를 CANCELLED로 전이해 기존 status 기반 집계가 자동 제외.
export async function deleteByAdminTx(requestId: string, adminId: string, reason: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const existing = await tx.leaveRequest.findFirst({
      where: { id: requestId, deletedAt: null }, select: { status: true, userId: true, startDate: true, days: true, updatedAt: true },
    });
    if (!existing) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    const wasApproved = existing.status === "APPROVED";
    // 낙관적 CAS: 관찰한 status·days(=updatedAt)·미삭제일 때만 전이. 0행이면 그 사이 approve/cancel/타 admin 수정/삭제됨
    // → 충돌로 막아 usedDays 정합성 보호(read-then-update race + days-ABA 방지). updatedAt(@updatedAt)이 days 변경도 잡는다.
    const transition = await tx.leaveRequest.updateMany({
      where: { id: requestId, deletedAt: null, status: existing.status, updatedAt: existing.updatedAt },
      data: { status: "CANCELLED", deletedByAdminId: adminId, deletedAt: now, deleteReason: reason, cancelledAt: now, cancellationReason: reason },
    });
    if (transition.count === 0) throw new LeaveConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
    // 실제 전이된 status에만 usedDays 보정 — CAS 성공이 곧 APPROVED 유지를 보증(approve와 race 시 위 0행으로 차단됨).
    if (wasApproved) {
      const r = await tx.leaveAllocation.updateMany({
        where: { userId: existing.userId, year: existing.startDate.getUTCFullYear() },
        data: { usedDays: { decrement: existing.days } },
      });
      if (r.count === 0) throw new LeaveConflictError("연차 할당 정보를 찾을 수 없습니다.");
    }
    await cancelPendingDeliveries(tx, requestId, now); // PENDING/FAILED/stale SENDING만 취소(active SENDING은 worker가 정직 finalize — 결정 A)
    await writeAudit(tx, { actorId: adminId, entityType: "LeaveRequest", entityId: requestId, action: "soft_delete", metadata: { reason } });
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
    // allocatedDays는 원자 increment로 갱신(동시 조정 시 lost update 방지).
    const updated = await tx.leaveAllocation.update({
      where: { userId_year: { userId: input.userId, year: input.year } },
      data: { allocatedDays: { increment: delta } },
    });
    if (Number(updated.allocatedDays) < 0) throw new LeaveConflictError("할당 연차가 음수가 될 수 없습니다.");
    // before/after = 갱신된 행 기준 잔여(total - used). 동시성 하에서도 이 트랜잭션의 실제 반영값을 기록.
    const afterDays = Number(updated.allocatedDays) + Number(updated.carriedOverDays) - Number(updated.usedDays);
    const beforeDays = afterDays - delta;
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
