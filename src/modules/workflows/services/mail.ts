import "server-only";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { MailDelivery, WorkflowKind, WorkflowStatus } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { sendMail, type MailMessage } from "@/lib/integrations/mail";
import { getSmtpConfig } from "@/kernel/settings/reader";
import { resolveStoragePath, toStoredOutputPath } from "@/lib/storage";
import { ConflictError, type MailActionCtx } from "../types";
import { KIND_RESOURCE, sendStepTransition } from "../policy";
import { claimFailedForRetry, createSendingDelivery, finalizeDelivery, finalizeDeliveryWithTransition, findDeliveryForAction } from "../repositories/mail";

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
  expectedTaskStatus?: WorkflowStatus; // D11
  onDelivered?: { fromStatus: WorkflowStatus; toStatus: WorkflowStatus; actorId: string }; // G2b
}): Promise<MailDelivery> {
  // 멱등 가드 + SENDING 선기록. 활성 중복이면 ConflictError(SMTP 미발생).
  const record = await createSendingDelivery({
    taskId: args.taskId,
    step: args.step,
    recipients: args.msg.to,
    subject: args.msg.subject,
    bodyHtml: args.msg.html,
    // D8·I4: 첨부 절대경로 → storage-relative로 저장(out 밖이면 throw). 빈 배열이면 그대로 [](leave/무첨부 무영향).
    attachmentPaths: (args.msg.attachments ?? []).map((a) => toStoredOutputPath(a.path)),
    sentById: args.sentById,
    expectedTaskStatus: args.expectedTaskStatus,
  });

  // SMTP 실패만 FAILED로 확정한다. sendMail 성공 후 SENT 확정(finalizeDelivery)이 실패하면
  // 메일은 이미 나갔으므로 FAILED로 둔갑시키지 않는다(재시도 시 중복 발송). 에러를 전파해
  // 행을 SENDING으로 남기고, admin resolve로 수동 확정하게 한다(§6.2).
  const smtpConfig = await getSmtpConfig(); // 멱등 가드 통과 후 해석(ConflictError 시 미발생)
  let providerMessageId: string | null;
  try {
    ({ providerMessageId } = await sendMail(args.msg, smtpConfig));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return finalizeDelivery(record.id, { status: "FAILED", sentAt: null, errorMessage: message });
  }
  // G2b: 성공 시 finalize+전이 한 tx(전이 지정 시). 미지정이면 기존 동작(전이 없음).
  if (args.onDelivered && args.taskId != null) {
    return finalizeDeliveryWithTransition(record.id, { providerMessageId }, {
      taskId: args.taskId,
      fromStatus: args.onDelivered.fromStatus,
      toStatus: args.onDelivered.toStatus,
      actorId: args.onDelivered.actorId,
    });
  }
  return finalizeDelivery(record.id, { status: "SENT", sentAt: new Date(), providerMessageId });
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

  // 단일 비행 점유: FAILED→SENDING 원자 갱신. 동시 재시도 중 진 쪽은 여기서 멈춰
  // SMTP 중복 발송을 차단한다. 점유 후엔 SENDING이므로 cancel 게이트/멱등 가드에도 가시화된다(§6.2).
  if (!(await claimFailedForRetry(d.id, args.taskId))) {
    throw new ConflictError("이미 재시도가 진행 중입니다.");
  }

  // I4: 저장된 storage-relative 경로를 strict resolve. 절대경로 row면 throw → FAILED 확정(exfiltration 차단).
  let absPaths: string[];
  try {
    absPaths = d.attachmentPaths.map((p) => resolveStoragePath(p));
  } catch {
    return finalizeDelivery(d.id, { status: "FAILED", sentAt: null, errorMessage: "첨부 경로가 유효하지 않습니다." });
  }
  const missing = absPaths.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    return finalizeDelivery(d.id, { status: "FAILED", sentAt: null, errorMessage: `첨부 파일 없음: ${missing.join(", ")}` });
  }

  // deliver와 동일: SMTP 실패만 FAILED로 되돌린다. 재발송 SMTP 수락 후 SENT 확정이 실패하면
  // 에러를 전파해 SENDING으로 남긴다(admin resolve 대상) — FAILED로 변환하면 또 재시도되어 중복 발송된다.
  const smtpConfig = await getSmtpConfig();
  let providerMessageId: string | null;
  try {
    ({ providerMessageId } = await sendMail({
      to: d.recipients,
      subject: d.subject,
      html: d.bodyHtml ?? "",
      attachments: absPaths.map((p) => ({ filename: basename(p), path: p })),
    }, smtpConfig));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return finalizeDelivery(d.id, { status: "FAILED", sentAt: null, errorMessage: message });
  }
  // 복구도 happy-path(G2b)와 대칭: step 전이가 있는 task-scoped 발송이면 SENT 확정 + 워크플로 전이를
  // 한 tx로 적용한다. 누락하면 메일은 나갔는데 task가 fromStatus에 묶여 다음 단계로 진행 못 한다.
  const transition = sendStepTransition(d.kind, d.step);
  if (transition && d.taskId) {
    return finalizeDeliveryWithTransition(d.id, { providerMessageId }, {
      taskId: d.taskId, fromStatus: transition.from, toStatus: transition.to, actorId: ctx.userId,
    });
  }
  return finalizeDelivery(d.id, { status: "SENT", sentAt: new Date(), providerMessageId });
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
  // SENDING→SENT(메일은 이미 나갔으나 finalize+전이 tx가 실패해 남은 잔여)면 워크플로 전이도 함께 적용한다.
  // FAILED 확정은 전이 없음(발송 실패가 전이를 막지 않는다).
  const transition = args.to === "SENT" ? sendStepTransition(d.kind, d.step) : null;
  if (transition && d.taskId) {
    return finalizeDeliveryWithTransition(d.id, { providerMessageId: null }, {
      taskId: d.taskId, fromStatus: transition.from, toStatus: transition.to, actorId: ctx.userId,
    });
  }
  return finalizeDelivery(d.id, {
    status: args.to,
    sentAt: args.to === "SENT" ? new Date() : null,
    errorMessage: args.to === "FAILED" ? "운영자가 실패로 확정" : null,
  });
}
