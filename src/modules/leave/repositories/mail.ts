import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTx } from "@/lib/prisma";

export const MAIL_MAX_ATTEMPTS = 3;
export const MAIL_LEASE_MS = 60_000;

export type LeaveMailEvent = "REQUESTED" | "APPROVED" | "REJECTED" | "ADMIN_CREATED";

// 발송 본문 묶음(Task 06이 도메인 tx에 넘기는 형태). insert/templates가 공유.
export interface MailJob { recipients: string[]; subject: string; bodyHtml: string }

// 후보 조건(claim/list 공유): leave 스코프 + 발송 가능 상태. workflow 행(leaveRequestId NULL)은 제외.
function dueWhere(now: Date) {
  return {
    leaveRequestId: { not: null },
    eventType: { not: null },
    OR: [
      { status: "PENDING" as const },
      { status: "FAILED" as const, attempts: { lt: MAIL_MAX_ATTEMPTS } },
      { status: "SENDING" as const, lockedUntil: { lt: now }, attempts: { lt: MAIL_MAX_ATTEMPTS } },
    ],
  };
}

// 트랜잭션 내부 idempotent insert. @@unique(leaveRequestId,eventType) 충돌은 무시(이벤트당 1행 보장).
export async function insertPendingDelivery(
  tx: PrismaTx,
  args: { leaveRequestId: string; eventType: LeaveMailEvent } & MailJob,
): Promise<void> {
  try {
    await tx.mailDelivery.create({
      data: {
        leaveRequestId: args.leaveRequestId, eventType: args.eventType, status: "PENDING",
        recipients: args.recipients, subject: args.subject, bodyHtml: args.bodyHtml, attempts: 0,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return; // 이미 예약됨
    throw e;
  }
}

// soft-delete tx 내부: 아직 발송 안 했거나 발송 중이 아닌 행만 CANCELLED — PENDING/FAILED/stale SENDING(lease 만료=크래시).
// **active SENDING(lease 유효, worker 발송중)은 건드리지 않는다** — 정직한 finalize(SENT/FAILED) 보존(결정 A: 실제 나간 메일을
// CANCELLED로 지워 감사를 왜곡하지 않음). 삭제는 deletedAt+AuditLog로 별도 감사. worker는 발송 직전 deletedAt 재확인으로
// 대부분의 "claim 후 삭제"를 미발송 처리한다(drainLeaveMailOutbox). 잔여 윈도(발송 진행 중 삭제)는 SENT로 정직 기록(at-least-once).
export async function cancelPendingDeliveries(tx: PrismaTx, leaveRequestId: string, now: Date): Promise<void> {
  await tx.mailDelivery.updateMany({
    where: {
      leaveRequestId,
      OR: [{ status: "PENDING" }, { status: "FAILED" }, { status: "SENDING", lockedUntil: { lt: now } }],
    },
    data: { status: "CANCELLED", lockedUntil: null },
  });
}

// dead-letter: claim이 attempts를 먼저 올리므로, N번째 claim 후 크래시하면 stale SENDING·attempts>=N으로 남아
// dueWhere(attempts < N)에 안 잡혀 영구 표류한다(finding). 발송하지 않고 FAILED로 종결(운영자 가시·재시도 종료).
export async function deadLetterStaleSending(now: Date): Promise<number> {
  const { count } = await prisma.mailDelivery.updateMany({
    where: {
      leaveRequestId: { not: null }, eventType: { not: null },
      status: "SENDING", lockedUntil: { lt: now }, attempts: { gte: MAIL_MAX_ATTEMPTS },
    },
    data: { status: "FAILED", errorMessage: "최대 시도 초과(stale SENDING 회수 한도)", lockedUntil: null },
  });
  return count;
}

export async function listDueDeliveryIds(now: Date, limit: number): Promise<string[]> {
  const rows = await prisma.mailDelivery.findMany({
    where: dueWhere(now), select: { id: true }, take: limit, orderBy: { id: "asc" },
  });
  return rows.map((r) => r.id);
}

export interface ClaimedDelivery { id: string; leaveRequestId: string; eventType: LeaveMailEvent; recipients: string[]; subject: string; bodyHtml: string; }

// atomic 조건부 claim: 후보 조건이 여전히 참일 때만 SENDING+lease+workerId+attempts++. 0행=선점 → null.
export async function claimDelivery(id: string, workerId: string, now: Date): Promise<ClaimedDelivery | null> {
  const { count } = await prisma.mailDelivery.updateMany({
    where: { id, ...dueWhere(now) },
    data: { status: "SENDING", lockedUntil: new Date(now.getTime() + MAIL_LEASE_MS), workerId, attempts: { increment: 1 } },
  });
  if (count !== 1) return null;
  const d = await prisma.mailDelivery.findUnique({
    where: { id }, select: { id: true, leaveRequestId: true, eventType: true, recipients: true, subject: true, bodyHtml: true, workerId: true, status: true },
  });
  if (!d || d.status !== "SENDING" || d.workerId !== workerId || !d.leaveRequestId) return null;
  return {
    id: d.id,
    leaveRequestId: d.leaveRequestId,
    eventType: d.eventType as LeaveMailEvent, // dueWhere가 eventType not null·leave 스코프를 보장 → 4종 중 하나
    recipients: Array.isArray(d.recipients) ? (d.recipients as string[]) : [],
    subject: d.subject,
    bodyHtml: d.bodyHtml ?? "",
  };
}

// 조건부 finalize: status=SENDING AND workerId=self일 때만. 0행=CANCELLED/선점 → false(terminal 덮지 않음).
// CANCELLED는 발송 직전 deletedAt 재확인에서 사용(요청 삭제됨 → 미발송 종결).
export async function finalizeDelivery(id: string, workerId: string, patch: {
  status: "SENT" | "FAILED" | "CANCELLED"; providerMessageId?: string | null; errorMessage?: string | null;
}): Promise<boolean> {
  const { count } = await prisma.mailDelivery.updateMany({
    where: { id, status: "SENDING", workerId },
    data: {
      status: patch.status,
      sentAt: patch.status === "SENT" ? new Date() : null,
      providerMessageId: patch.providerMessageId ?? null,
      errorMessage: patch.errorMessage ?? null,
      lockedUntil: null,
    },
  });
  return count === 1;
}
