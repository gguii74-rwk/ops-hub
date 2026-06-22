import "server-only";
import type { LeaveRequestStatus, LeaveType, LeaveSubType } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { prisma } from "@/lib/prisma";
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
import { getLeaveAdminRecipients, triggerLeaveMailDrain } from "./mail"; // triggerLeaveMailDrain = drain().catch() 래퍼(unhandled rejection 방지)
import type { MailJob } from "../repositories/mail";
import {
  buildRequestNotification, buildApprovedNotification, buildRejectedNotification, buildAdminCreatedNotification, type MailReqLike,
} from "../mail-templates";
import { assertTargetUser } from "../authz";
import { QUARTER_START_TIMES } from "../labels"; // effective-state 교차검증(반반차 화이트리스트)

// 템플릿 출력({subject,html})을 outbox MailJob({recipients,subject,bodyHtml})로 어댑트.
const toMailJob = (recipients: string[], tpl: { subject: string; html: string }): MailJob => ({
  recipients, subject: tpl.subject, bodyHtml: tpl.html,
});

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

  const applicant = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  // enqueue 스냅샷: REQUESTED 행을 항상 적재하기 위한 durable 기록. 단 **실제 발송 수신자 결정의 SSOT는 drain**이며,
  // worker가 REQUESTED 발송 직전 getLeaveAdminRecipients()로 재확정한다(결정 A) — claim~발송 사이 권한 변동 반영.
  const recipients = await getLeaveAdminRecipients();
  const reqLike: MailReqLike = { leaveType: input.leaveType, leaveSubType: input.leaveSubType ?? null, quarterStartTime: input.quarterStartTime ?? null, startDate: start, endDate: end, reason: input.reason ?? null };
  // 수신자 0명(승인권한자 없음/조회 저하)이어도 REQUESTED 행은 **항상** 적재 — durable 기록(spec §8). worker가 "수신자 없음" FAILED로 종결해 운영자가 누락을 본다.
  const mailJob = toMailJob(recipients, buildRequestNotification(applicant?.name ?? "직원", reqLike));
  const created = await createPendingRequest({
    userId, leaveType: input.leaveType, leaveSubType: input.leaveSubType,
    quarterStartTime: input.quarterStartTime, startDate: start, endDate: end, days, reason: input.reason,
  }, mailJob);
  triggerLeaveMailDrain();
  return created;
}

// 관리자 직접입력 — 자동 APPROVED, 과거 허용.
export async function createLeaveRequestByAdmin(adminId: string, targetUserId: string, input: CreateLeaveInput, adminActionNote?: string | null, sendNotification?: boolean) {
  await assertTargetUser(targetUserId); // 위조 userId 거부(존재·ACTIVE 재검증)
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

  let mailJob: MailJob | null = null;
  if (sendNotification) {
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { email: true } });
    const reqLike: MailReqLike = { leaveType: input.leaveType, leaveSubType: input.leaveSubType ?? null, quarterStartTime: input.quarterStartTime ?? null, startDate: start, endDate: end, reason: input.reason ?? null };
    if (target?.email) mailJob = toMailJob([target.email], buildAdminCreatedNotification(reqLike));
  }
  const created = await createApprovedRequestTx({
    userId: targetUserId, adminId, leaveType: input.leaveType, leaveSubType: input.leaveSubType,
    quarterStartTime: input.quarterStartTime, startDate: start, endDate: end, days, reason: input.reason, adminActionNote,
  }, mailJob);
  if (mailJob) triggerLeaveMailDrain();
  return created;
}

export function listMyRequests(userId: string, statuses?: LeaveRequestStatus[]) {
  return listRequests({ userId, statuses });
}

// 전체(타인 포함) 신청 + 사용자 표시정보. User(kernel)↔LeaveRequest(leave)는 cross-schema relation이
// 없으므로 userId로 별도 조회해 병합한다(승인 큐·전체 이력 공유).
export async function listAllRequestsWithUser(filter: { userId?: string; statuses?: LeaveRequestStatus[] }) {
  const items = await listRequests(filter);
  const userIds = [...new Set(items.map((i) => i.userId))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, department: true, email: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return items.map((i) => ({ ...i, user: byId.get(i.userId) ?? null }));
}

export async function getRequest(id: string, ctx: LeaveCtx) {
  const req = await getRequestById(id);
  if (!req) return null;
  if (req.userId === ctx.userId) return req; // 본인 → 전 상태
  // 타인 신청의 cross-user 가시성 경계(spec §4): 전체이력 권한(admin:view/시스템 OWNER) → 전 상태,
  // 승인 큐 권한(approval:view)은 처리 대상인 PENDING만. approval:view는 read-all 자격이 아니다
  // (전체이력 목록은 task-05가 admin:view로 잠갔으나 단건 상세 경로가 누락돼 있었음).
  const canViewAll = ctx.isOwner || ctx.permissionKeys.has("leave.admin:view");
  const canViewPending = ctx.permissionKeys.has("leave.approval:view") && req.status === "PENDING";
  if (canViewAll || canViewPending) return req;
  throw new ForbiddenError("본인 신청만 조회할 수 있습니다.");
}

export async function approve(requestId: string, adminId: string) {
  const req = await getRequestById(requestId);
  if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } });
  const mailJob = user?.email ? toMailJob([user.email], buildApprovedNotification(req)) : null;
  await approveTx(requestId, adminId, mailJob);
  triggerLeaveMailDrain();
}
export async function reject(requestId: string, adminId: string, rejectionReason: string) {
  const req = await getRequestById(requestId);
  if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } });
  const mailJob = user?.email ? toMailJob([user.email], buildRejectedNotification(req, rejectionReason)) : null;
  await rejectRequest(requestId, adminId, rejectionReason, mailJob);
  triggerLeaveMailDrain();
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
// expectedUpdatedAt: 클라가 본 신청 행 버전(stale-tab lost-update 차단). updateByAdminTx의 CAS where에 쓴다.
export async function updateByAdmin(requestId: string, input: {
  leaveType?: LeaveType; leaveSubType?: LeaveSubType | null; quarterStartTime?: string | null;
  startDate?: string; endDate?: string; reason?: string | null; adminActionNote?: string | null;
}, adminId: string, expectedUpdatedAt: Date) {
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

  // 부분 patch + 기존 행 fallback으로 만든 effective state를 서버에서 교차검증 — update zod가 부분 patch라
  // 예컨대 ANNUAL→HALF인데 leaveSubType 미전달이면 fallback이 null로 남아 유효하지 않은 행이 저장된다.
  const effSubType = leaveType === "HALF" ? (input.leaveSubType ?? existing.leaveSubType) : null;
  const effQuarter = leaveType === "QUARTER" ? (input.quarterStartTime ?? existing.quarterStartTime) : null;
  if (leaveType === "HALF" && !effSubType) throw new LeaveValidationError("반차는 오전/오후 구분이 필요합니다.");
  if (leaveType === "QUARTER" && (!effQuarter || !QUARTER_START_TIMES.includes(effQuarter))) {
    throw new LeaveValidationError("반반차는 허용된 시간대(6종) 중 하나가 필요합니다.");
  }

  return updateByAdminTx(requestId, {
    adminId,
    leaveType,
    leaveSubType: effSubType,
    quarterStartTime: effQuarter,
    startDate: start, endDate: end, newDays,
    reason: input.reason !== undefined ? input.reason : existing.reason,
    adminActionNote: input.adminActionNote ?? null,
    expectedUpdatedAt,
  });
}

export function deleteByAdmin(requestId: string, adminId: string, reason: string) {
  return deleteByAdminTx(requestId, adminId, reason);
}
