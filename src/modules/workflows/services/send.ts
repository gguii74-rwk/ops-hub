import "server-only";
import fs from "node:fs";
import path from "node:path";
import { ForbiddenError } from "@/kernel/access";
import { resolveStoragePath } from "@/lib/storage";
import { ConflictError, NotImplementedError, type TransitionCtx } from "../types";
import { KIND_RESOURCE, sendStepTransition } from "../policy";
import { findTaskForSend } from "../repositories";
import { deliver } from "./mail";

function can(ctx: TransitionCtx, resource: string, action: string): boolean {
  return ctx.isOwner || ctx.permissionKeys.has(`${resource}:${action}`);
}

// 1·2단계만(F2). step3(FINAL_SENT)은 업로드 artifact 계약이 필요 → 후속 UI spec.
// from/to 전이는 policy.sendStepTransition(단일 출처)에서, 단계별 첨부 여부만 여기서 정한다.
const STEP_ATTACH: Record<1 | 2, boolean> = { 1: true, 2: false };
const ATTACH_EXTENSIONS = [".hwpx", ".xlsx"]; // 대금청구 1단계: hwpx 4종(xlsx는 다른 kind 대비)

export async function runSend(
  taskId: string,
  input: { step: number; subject: string; body: string; recipients?: string[]; cc?: string[]; bcc?: string[] },
  ctx: TransitionCtx,
): Promise<void> {
  if (input.step !== 1 && input.step !== 2) {
    throw new NotImplementedError("3단계(최종 발송)는 후속 단계에서 지원합니다."); // F2
  }
  const attach = STEP_ATTACH[input.step];

  const task = await findTaskForSend(taskId);
  if (!task) throw new ForbiddenError("작업을 찾을 수 없습니다.");
  if (!can(ctx, KIND_RESOURCE[task.kind], "send")) {
    throw new ForbiddenError(`${KIND_RESOURCE[task.kind]}:send 권한이 없습니다.`);
  }
  // from/to 전이는 단일 출처(policy). 이 kind/step이 발송 단계로 정의돼 있지 않으면 미지원(F2/일반화).
  const transition = sendStepTransition(task.kind, String(input.step));
  if (!transition) {
    throw new NotImplementedError(`${task.kind} ${input.step}단계 발송은 지원하지 않습니다.`);
  }

  // 수신자 해석(D5): 입력(모달 명시 envelope) → type.defaultRecipients[step] → 거부. task.recipients 미참조(死필드).
  // 입력 여부 = recipients **존재**(undefined 아님) 기준 — `[]`는 "비운 명시 입력"이라 폴백하지 않고 거부한다
  // (length 판단이면 [] + cc가 defaults로 발송되는 의도치 않은 수신자 경로). 생략(undefined) 시에만 폴백.
  const fallback = task.defaultRecipients?.[String(input.step)];
  const envelope = input.recipients !== undefined
    ? { to: input.recipients, cc: input.cc ?? [], bcc: input.bcc ?? [] }
    : { to: fallback?.to ?? [], cc: fallback?.cc ?? [], bcc: fallback?.bcc ?? [] };
  if (envelope.to.length === 0) {
    throw new ConflictError("수신자가 없습니다. 수신자를 지정해 발송하세요.");
  }

  // 첨부 산출(spec §9.1): step1=outputPath 디렉터리 내 hwpx/xlsx, step2=없음.
  let attachments: Array<{ filename: string; path: string }> = [];
  if (attach) {
    if (!task.outputPath) throw new ConflictError("생성된 출력이 없습니다.");
    const absDir = resolveStoragePath(task.outputPath); // strict(F4)
    const entries = fs.readdirSync(absDir).filter((f) => ATTACH_EXTENSIONS.includes(path.extname(f).toLowerCase()));
    if (entries.length === 0) throw new ConflictError("첨부할 생성 파일이 없습니다.");
    attachments = entries.map((f) => ({ filename: f, path: path.join(absDir, f) }));
  }

  // deliver: D11(expectedTaskStatus 가드) + G2b(finalize+전이 한 tx). 첨부 절대경로 → deliver가 storage-relative로 저장.
  await deliver({
    taskId,
    step: String(input.step),
    msg: { to: envelope.to, cc: envelope.cc, bcc: envelope.bcc, subject: input.subject, html: input.body, attachments },
    sentById: ctx.userId,
    expectedTaskStatus: transition.from,
    onDelivered: { fromStatus: transition.from, toStatus: transition.to, actorId: ctx.userId },
  });
}
