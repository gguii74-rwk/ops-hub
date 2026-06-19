import "server-only";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { MailDelivery, WorkflowKind } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { sendMail, type MailMessage } from "@/lib/integrations/mail";
import { ConflictError, type MailActionCtx } from "../types";
import { KIND_RESOURCE } from "../policy";
import { createSendingDelivery, finalizeDelivery, findDeliveryForAction } from "../repositories/mail";

function canSend(ctx: MailActionCtx, kind: WorkflowKind): boolean {
  return ctx.isOwner || ctx.permissionKeys.has(`${KIND_RESOURCE[kind]}:send`);
}

// 발송 전 SENDING 레코드 생성 → SMTP → 정확히 1회 SENT/FAILED 갱신(§6.2).
// 워크플로 상태 전이와 분리 — 발송 실패가 직전 전이를 롤백하지 않는다.
// 호출자 계약: deliver는 자체 권한 검사를 하지 않는다. 외부 메일을 실제로 발송하므로
// 이 함수를 호출하는 워크플로 sub-project의 라우트가 반드시 `<kind>:send` 권한을 먼저 검증해야 한다.
// (재시도/해소는 retryDelivery/resolveDelivery가 자체적으로 authz를 강제한다.)
export async function deliver(args: {
  taskId: string | null; step: string | null; msg: MailMessage; sentById: string;
}): Promise<MailDelivery> {
  // 멱등 가드 + SENDING 선기록. 활성 중복이면 ConflictError(SMTP 미발생).
  const record = await createSendingDelivery({
    taskId: args.taskId,
    step: args.step,
    recipients: args.msg.to,
    subject: args.msg.subject,
    bodyHtml: args.msg.html,
    attachmentPaths: (args.msg.attachments ?? []).map((a) => a.path),
    sentById: args.sentById,
  });

  try {
    const { providerMessageId } = await sendMail(args.msg);
    return await finalizeDelivery(record.id, { status: "SENT", sentAt: new Date(), providerMessageId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return finalizeDelivery(record.id, { status: "FAILED", sentAt: null, errorMessage: message });
  }
}

// FAILED 레코드를 저장된 본문으로 그대로 재발송(워크플로 재생성 없음). 새 행 없이 기존 레코드를 갱신.
export async function retryDelivery(
  args: { deliveryId: string; taskId: string },
  ctx: MailActionCtx,
): Promise<MailDelivery> {
  const d = await findDeliveryForAction(args.deliveryId);
  if (!d) throw new ForbiddenError("발송 이력을 찾을 수 없습니다.");
  if (d.taskId !== args.taskId) throw new ForbiddenError("해당 작업의 발송이 아닙니다.");
  if (d.status !== "FAILED") throw new ConflictError("실패한 발송만 재시도할 수 있습니다.");
  if (!d.kind || !canSend(ctx, d.kind)) throw new ForbiddenError("재발송 권한이 없습니다.");

  // 첨부가 shared storage에서 사라졌으면 조용히 실패시키지 않고 FAILED로 확정(§6.2).
  const missing = d.attachmentPaths.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    return finalizeDelivery(d.id, { status: "FAILED", sentAt: null, errorMessage: `첨부 파일 없음: ${missing.join(", ")}` });
  }

  try {
    const { providerMessageId } = await sendMail({
      to: d.recipients,
      subject: d.subject,
      html: d.bodyHtml ?? "",
      attachments: d.attachmentPaths.map((p) => ({ filename: basename(p), path: p })),
    });
    return await finalizeDelivery(d.id, { status: "SENT", sentAt: new Date(), providerMessageId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return finalizeDelivery(d.id, { status: "FAILED", sentAt: null, errorMessage: message });
  }
}

// admin 전용. SENDING 잔여를 SENT/FAILED로 수동 확정해 멱등 가드를 해제·종료(§6.3).
export async function resolveDelivery(
  args: { deliveryId: string; taskId: string; to: "SENT" | "FAILED" },
  ctx: MailActionCtx,
): Promise<MailDelivery> {
  if (!ctx.isAdmin) throw new ForbiddenError("관리자만 해소할 수 있습니다.");
  const d = await findDeliveryForAction(args.deliveryId);
  if (!d) throw new ForbiddenError("발송 이력을 찾을 수 없습니다.");
  if (d.taskId !== args.taskId) throw new ForbiddenError("해당 작업의 발송이 아닙니다.");
  if (d.status !== "SENDING") throw new ConflictError("SENDING 상태만 수동 확정할 수 있습니다.");
  return finalizeDelivery(d.id, {
    status: args.to,
    sentAt: args.to === "SENT" ? new Date() : null,
    errorMessage: args.to === "FAILED" ? "운영자가 실패로 확정" : null,
  });
}
