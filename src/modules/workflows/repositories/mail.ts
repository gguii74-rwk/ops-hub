import "server-only";
import { Prisma } from "@prisma/client";
import type { MailDelivery, MailDeliveryStatus, WorkflowKind } from "@prisma/client";
import { prisma, type PrismaTx } from "@/lib/prisma";
import { ConflictError } from "../types";

export interface DeliveryForAction {
  id: string; taskId: string | null; step: string | null; status: MailDeliveryStatus;
  recipients: string[]; subject: string; bodyHtml: string | null; attachmentPaths: string[];
  kind: WorkflowKind | null;
}

// (taskId,step) 멱등 가드(tx 내 활성 조회 + create). 경합 시 부분 unique 인덱스 P2002 → ConflictError.
export async function createSendingDelivery(args: {
  taskId: string | null; step: string | null; recipients: string[]; subject: string;
  bodyHtml: string; attachmentPaths: string[]; sentById: string;
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
      }
      return tx.mailDelivery.create({
        data: {
          taskId: args.taskId,
          step: args.step,
          status: "SENDING",
          recipients: args.recipients,
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
export async function claimFailedForRetry(deliveryId: string, taskId: string): Promise<boolean> {
  const { count } = await prisma.mailDelivery.updateMany({
    where: { id: deliveryId, taskId, status: "FAILED" },
    data: { status: "SENDING" },
  });
  return count === 1;
}

export async function findDeliveryForAction(deliveryId: string): Promise<DeliveryForAction | null> {
  const d = await prisma.mailDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true, taskId: true, step: true, status: true, recipients: true, subject: true,
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
    subject: d.subject,
    bodyHtml: d.bodyHtml,
    attachmentPaths: Array.isArray(d.attachmentPaths) ? (d.attachmentPaths as string[]) : [],
    kind: d.task?.type.kind ?? null,
  };
}
