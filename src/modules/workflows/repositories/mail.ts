import "server-only";
import { Prisma } from "@prisma/client";
import type { MailDelivery, MailDeliveryStatus, WorkflowKind, WorkflowStatus } from "@prisma/client";
import { prisma, type PrismaTx } from "@/lib/prisma";
import { ConflictError } from "../types";

export interface DeliveryForAction {
  id: string; taskId: string | null; step: string | null; status: MailDeliveryStatus;
  recipients: string[]; cc: string[]; bcc: string[]; subject: string; bodyHtml: string | null; attachmentPaths: string[];
  kind: WorkflowKind | null;
}

// (taskId,step) 멱등 가드(tx 내 활성 조회 + create). 경합 시 부분 unique 인덱스 P2002 → ConflictError.
export async function createSendingDelivery(args: {
  taskId: string | null; step: string | null; recipients: string[]; cc?: string[]; bcc?: string[]; subject: string;
  bodyHtml: string; attachmentPaths: string[]; sentById: string;
  expectedTaskStatus?: WorkflowStatus; // D11: task가 이 status일 때만 SENDING 생성(cancel과 상호배제)
}): Promise<MailDelivery> {
  // task-scoped 발송은 멱등 키 step이 필수다. step=null이면 부분 unique 인덱스가
  // 작동하지 않아(Postgres에서 NULL은 충돌하지 않음) 중복 발송을 막을 수 없으므로 거부한다.
  if (args.taskId != null && args.step == null) {
    throw new Error("task-scoped 발송(taskId 지정)에는 멱등 키 step이 필요합니다.");
  }
  try {
    return await prisma.$transaction(async (tx: PrismaTx) => {
      if (args.taskId != null) {
        const active = await tx.mailDelivery.findFirst({
          where: { taskId: args.taskId, step: args.step, status: { in: ["SENDING", "SENT"] } },
          select: { id: true },
        });
        if (active) throw new ConflictError("이미 진행 중이거나 완료된 발송이 있습니다.");
        if (args.expectedTaskStatus != null) {
          // D11: task 행 잠금(FOR UPDATE) + status 가드 → cancel(H1)의 조건부 UPDATE와 같은 행에서 직렬화.
          const rows = await tx.$queryRaw<Array<{ status: WorkflowStatus }>>`
            SELECT status FROM workflows."WorkflowTask" WHERE id = ${args.taskId} FOR UPDATE`;
          if (rows.length === 0 || rows[0].status !== args.expectedTaskStatus) {
            throw new ConflictError("작업 상태가 발송 가능 상태가 아닙니다.");
          }
        }
      }
      return tx.mailDelivery.create({
        data: {
          taskId: args.taskId,
          step: args.step,
          status: "SENDING",
          recipients: args.recipients,
          cc: args.cc ?? [],
          bcc: args.bcc ?? [],
          subject: args.subject,
          bodyHtml: args.bodyHtml,
          attachmentPaths: args.attachmentPaths,
          sentById: args.sentById,
          sentAt: null,
        },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ConflictError("이미 진행 중인 발송이 있습니다.");
    }
    throw e;
  }
}

// SENDING인 동안에만 정확히 1회 SENT/FAILED로 확정(compare-and-set). 조건 없는 update는
// retry 발송 창에 끼어든 admin resolve(또는 동시 resolve)를 조용히 덮어쓰므로(LWW) 금지한다.
// 대상이 이미 SENDING이 아니면 다른 경로가 먼저 확정한 것 → ConflictError(409)로 가시화한다.
// providerMessageId는 지정 시에만 갱신(resolve가 기존 값을 지우지 않게).
export async function finalizeDelivery(
  id: string,
  patch: { status: "SENT" | "FAILED"; sentAt: Date | null; providerMessageId?: string | null; errorMessage?: string | null },
): Promise<MailDelivery> {
  const data: Prisma.MailDeliveryUpdateManyMutationInput = {
    status: patch.status,
    sentAt: patch.sentAt,
    errorMessage: patch.errorMessage ?? null,
  };
  if (patch.providerMessageId !== undefined) data.providerMessageId = patch.providerMessageId;
  const { count } = await prisma.mailDelivery.updateMany({ where: { id, status: "SENDING" }, data });
  if (count !== 1) throw new ConflictError("발송이 이미 다른 경로에서 확정되었습니다.");
  return prisma.mailDelivery.findUniqueOrThrow({ where: { id } });
}

// 재시도 단일 비행 가드: FAILED→SENDING 원자 점유. 동시 retry 중 1건만 count 1을 받고,
// 나머지는 0(이미 SENDING/다른 상태) → false. 점유 성공 후에만 SMTP를 발송한다(§6.2).
// expectedTaskStatus 지정 시(step 전이가 있는 발송) D11/H1을 retry까지 확장(R4-1): task 행을 FOR UPDATE로
// 잠가 cancel(cancelTaskAtomic의 조건부 UPDATE)과 직렬화하고, task가 기대 상태일 때만 점유한다 —
// 취소·단계 어긋남이면 SMTP 전에 거부. 미지정(전이 없는 발송)은 기존 동작 유지.
export async function claimFailedForRetry(
  deliveryId: string,
  taskId: string,
  expectedTaskStatus?: WorkflowStatus,
): Promise<boolean> {
  if (expectedTaskStatus == null) {
    const { count } = await prisma.mailDelivery.updateMany({
      where: { id: deliveryId, taskId, status: "FAILED" },
      data: { status: "SENDING" },
    });
    return count === 1;
  }
  return prisma.$transaction(async (tx: PrismaTx) => {
    const rows = await tx.$queryRaw<Array<{ status: WorkflowStatus }>>`
      SELECT status FROM workflows."WorkflowTask" WHERE id = ${taskId} FOR UPDATE`;
    if (rows.length === 0 || rows[0].status !== expectedTaskStatus) return false;
    const { count } = await tx.mailDelivery.updateMany({
      where: { id: deliveryId, taskId, status: "FAILED" },
      data: { status: "SENDING" },
    });
    return count === 1;
  });
}

export async function findDeliveryForAction(deliveryId: string): Promise<DeliveryForAction | null> {
  const d = await prisma.mailDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true, taskId: true, step: true, status: true, recipients: true, cc: true, bcc: true, subject: true,
      bodyHtml: true, attachmentPaths: true,
      task: { select: { type: { select: { kind: true } } } },
    },
  });
  if (!d) return null;
  return {
    id: d.id,
    taskId: d.taskId,
    step: d.step,
    status: d.status,
    recipients: Array.isArray(d.recipients) ? (d.recipients as string[]) : [],
    cc: Array.isArray(d.cc) ? (d.cc as string[]) : [],
    bcc: Array.isArray(d.bcc) ? (d.bcc as string[]) : [],
    subject: d.subject,
    bodyHtml: d.bodyHtml,
    attachmentPaths: Array.isArray(d.attachmentPaths) ? (d.attachmentPaths as string[]) : [],
    kind: d.task?.type.kind ?? null,
  };
}

// G2b: SMTP 성공 후 finalize(SENT)+task 전이를 한 tx로. SENDING이 이 tx 직전까지 유지되므로
// "delivery=SENT인데 task 미전이" cancel 침투 창이 없다. SENT 전이만 sentAt stamp(STAMP_FOR_STATUS).
export async function finalizeDeliveryWithTransition(
  deliveryId: string,
  patch: { providerMessageId: string | null },
  transition: { taskId: string; fromStatus: WorkflowStatus; toStatus: WorkflowStatus; actorId: string },
): Promise<MailDelivery> {
  try {
    await prisma.$transaction(async (tx: PrismaTx) => {
      const fin = await tx.mailDelivery.updateMany({
        where: { id: deliveryId, status: "SENDING" },
        data: { status: "SENT", sentAt: new Date(), providerMessageId: patch.providerMessageId, errorMessage: null },
      });
      if (fin.count !== 1) throw new ConflictError("발송이 이미 다른 경로에서 확정되었습니다.");
      const trans = await tx.workflowTask.updateMany({
        where: { id: transition.taskId, status: transition.fromStatus },
        data: transition.toStatus === "SENT" ? { status: "SENT", sentAt: new Date() } : { status: transition.toStatus },
      });
      if (trans.count === 0) throw new ConflictError("작업 상태가 이미 변경되었습니다.");
      await tx.workflowTaskEvent.create({
        data: { taskId: transition.taskId, fromStatus: transition.fromStatus, toStatus: transition.toStatus, actorId: transition.actorId },
      });
    });
  } catch (e) {
    // 복구 경로(retry/resolve)가 호출할 때, 같은 (taskId,step)에 이미 활성 SENT가 있으면 SENDING→SENT 갱신이
    // 부분 unique 인덱스를 위반(P2002)한다 → 중복 확정을 409로 가시화(500 방지). happy-path는 createSendingDelivery가
    // 활성 중복을 막아 여기 도달하지 않는다.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ConflictError("이미 진행 중이거나 완료된 발송이 있습니다.");
    }
    throw e;
  }
  return prisma.mailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
}
