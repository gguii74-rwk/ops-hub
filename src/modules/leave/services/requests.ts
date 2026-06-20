import "server-only";
import type { LeaveRequestStatus, LeaveType, LeaveSubType } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { getHolidaysInRange, ensureYearsSynced, getUnsyncedYears } from "@/kernel/holidays";
import type { CreateLeaveInput, LeaveCtx } from "../types";
import { LeaveConflictError, LeaveValidationError } from "../errors";
import {
  parseLeaveDate, validateDates, validateDatesForAdmin, validateLeaveTypeDates,
  calculateLeaveDays, kstToday, toDateKey,
} from "../rules";
import {
  getRequestById, listRequests, findActiveAllocation, findOverlap,
  createPendingRequest, createApprovedRequestTx, approveTx, rejectRequest,
  cancelTx, updateByAdminTx, deleteByAdminTx,
} from "../repositories";

// 신청 기간이 걸친 연도(시작~종료 inclusive — 다년 범위의 중간 연도까지 포함).
const spannedYears = (start: Date, end: Date) => {
  const years: number[] = [];
  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) years.push(y);
  return years;
};

// 직원 신청 — PENDING. 마이너스 연차 허용(잔여 부족도 거부 안 함).
export async function createLeaveRequest(userId: string, input: CreateLeaveInput) {
  const start = parseLeaveDate(input.startDate);
  const end = parseLeaveDate(input.endDate);
  validateDates(start, end, kstToday(new Date()));
  validateLeaveTypeDates(input.leaveType, start, end);
  const years = spannedYears(start, end);
  await ensureYearsSynced(years);
  const unsynced = await getUnsyncedYears(years);
  if (unsynced.length > 0) throw new LeaveValidationError(`공휴일 데이터가 준비되지 않았습니다(${unsynced.join(", ")}년). 관리자에게 문의하세요.`);
  const days = calculateLeaveDays(input.leaveType, start, end, await getHolidaysInRange(start, end));

  const year = start.getUTCFullYear();
  if (!(await findActiveAllocation(userId, year))) throw new LeaveValidationError(`${year}년도 연차 할당 정보가 없습니다.`);
  if (await findOverlap(userId, start, end)) throw new LeaveConflictError("해당 기간에 이미 신청된 연차가 있습니다.");

  return createPendingRequest({
    userId, leaveType: input.leaveType, leaveSubType: input.leaveSubType,
    quarterStartTime: input.quarterStartTime, startDate: start, endDate: end, days, reason: input.reason,
  });
}

// 관리자 직접입력 — 자동 APPROVED, 과거 허용.
export async function createLeaveRequestByAdmin(adminId: string, targetUserId: string, input: CreateLeaveInput, adminActionNote?: string | null) {
  const start = parseLeaveDate(input.startDate);
  const end = parseLeaveDate(input.endDate);
  validateDatesForAdmin(start, end);
  validateLeaveTypeDates(input.leaveType, start, end);
  const years = spannedYears(start, end);
  await ensureYearsSynced(years);
  const unsynced = await getUnsyncedYears(years);
  if (unsynced.length > 0) console.warn(`[leave] 공휴일 미적재(${unsynced.join(", ")}년) — 관리자 직접입력 일수가 부정확할 수 있음(targetUserId=${targetUserId})`);
  const days = calculateLeaveDays(input.leaveType, start, end, await getHolidaysInRange(start, end));

  if (await findOverlap(targetUserId, start, end)) throw new LeaveConflictError("해당 기간에 이미 신청된 연차가 있습니다.");

  return createApprovedRequestTx({
    userId: targetUserId, adminId, leaveType: input.leaveType, leaveSubType: input.leaveSubType,
    quarterStartTime: input.quarterStartTime, startDate: start, endDate: end, days, reason: input.reason, adminActionNote,
  });
}

export function listMyRequests(userId: string, statuses?: LeaveRequestStatus[]) {
  return listRequests({ userId, statuses });
}
export function listAllRequests(filter: { userId?: string; statuses?: LeaveRequestStatus[] }) {
  return listRequests(filter);
}

export async function getRequest(id: string, ctx: LeaveCtx) {
  const req = await getRequestById(id);
  if (!req) return null;
  const canManage = ctx.isOwner || ctx.permissionKeys.has("leave.approval:view");
  if (req.userId !== ctx.userId && !canManage) throw new ForbiddenError("본인 신청만 조회할 수 있습니다.");
  return req;
}

export function approve(requestId: string, adminId: string) {
  return approveTx(requestId, adminId);
}
export function reject(requestId: string, adminId: string, rejectionReason: string) {
  return rejectRequest(requestId, adminId, rejectionReason);
}

// 취소 — 본인 또는 관리자. 직원 본인은 APPROVED 당일/과거 취소 불가.
export async function cancel(requestId: string, ctx: LeaveCtx, cancellationReason: string | null) {
  const req = await getRequestById(requestId);
  if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
  const isManager = ctx.isOwner || ctx.permissionKeys.has("leave.request:update");
  if (req.userId !== ctx.userId && !isManager) throw new ForbiddenError("본인 또는 관리자만 취소할 수 있습니다.");
  if (!isManager && req.status === "APPROVED" && toDateKey(req.startDate) <= toDateKey(kstToday(new Date()))) {
    throw new LeaveValidationError("연차 사용일 당일 또는 이후에는 취소할 수 없습니다.");
  }
  await cancelTx(requestId, cancellationReason);
}

// 관리자 수정 — days 재계산 후 tx 보정.
export async function updateByAdmin(requestId: string, input: {
  leaveType?: LeaveType; leaveSubType?: LeaveSubType | null; quarterStartTime?: string | null;
  startDate?: string; endDate?: string; reason?: string | null; adminActionNote?: string | null;
}) {
  const existing = await getRequestById(requestId);
  if (!existing) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
  const start = input.startDate ? parseLeaveDate(input.startDate) : existing.startDate;
  const end = input.endDate ? parseLeaveDate(input.endDate) : existing.endDate;
  const leaveType = input.leaveType ?? existing.leaveType;
  validateDatesForAdmin(start, end);
  validateLeaveTypeDates(leaveType, start, end);
  const years = spannedYears(start, end);
  await ensureYearsSynced(years);
  const unsynced = await getUnsyncedYears(years);
  if (unsynced.length > 0) console.warn(`[leave] 공휴일 미적재(${unsynced.join(", ")}년) — 관리자 수정 일수가 부정확할 수 있음(requestId=${requestId})`);
  const newDays = calculateLeaveDays(leaveType, start, end, await getHolidaysInRange(start, end));

  if (await findOverlap(existing.userId, start, end, requestId)) throw new LeaveConflictError("해당 기간에 이미 다른 연차가 있습니다.");

  return updateByAdminTx(requestId, {
    leaveType,
    leaveSubType: leaveType === "HALF" ? (input.leaveSubType ?? existing.leaveSubType) : null,
    quarterStartTime: leaveType === "QUARTER" ? (input.quarterStartTime ?? existing.quarterStartTime) : null,
    startDate: start, endDate: end, newDays,
    reason: input.reason !== undefined ? input.reason : existing.reason,
    adminActionNote: input.adminActionNote ?? null,
  });
}

export function deleteByAdmin(requestId: string) {
  return deleteByAdminTx(requestId);
}
