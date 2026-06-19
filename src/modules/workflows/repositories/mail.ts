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
  try {
    return await prisma.$transaction(async (tx: PrismaTx) => {
      if (args.taskId != null && args.step != null) {
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

// 같은 레코드를 정확히 1회 SENT/FAILED로 갱신. providerMessageId는 지정 시에만 갱신(resolve가 기존 값을 지우지 않게).
export async function finalizeDelivery(
  id: string,
  patch: { status: "SENT" | "FAILED"; sentAt: Date | null; providerMessageId?: string | null; errorMessage?: string | null },
): Promise<MailDelivery> {
  const data: Prisma.MailDeliveryUpdateInput = {
    status: patch.status,
    sentAt: patch.sentAt,
    errorMessage: patch.errorMessage ?? null,
  };
  if (patch.providerMessageId !== undefined) data.providerMessageId = patch.providerMessageId;
  return prisma.mailDelivery.update({ where: { id }, data });
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
