import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { WorkflowStatus } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { resolveStoragePath } from "@/lib/storage";
import { ConflictError, NotImplementedError, type TransitionCtx } from "../types";
import { KIND_RESOURCE } from "../policy";
import { findTaskForSend } from "../repositories";
import { deliver } from "./mail";

function can(ctx: TransitionCtx, resource: string, action: string): boolean {
  return ctx.isOwner || ctx.permissionKeys.has(`${resource}:${action}`);
}

// 1·2단계만(F2). step3(FINAL_SENT)은 업로드 artifact 계약이 필요 → 후속 UI spec.
const STEP_MAP: Record<1 | 2, { from: WorkflowStatus; to: WorkflowStatus; attach: boolean }> = {
  1: { from: "GENERATED", to: "SENT", attach: true },
  2: { from: "SENT", to: "HQ_REQUESTED", attach: false },
};
const ATTACH_EXTENSIONS = [".hwpx", ".xlsx"]; // 대금청구 1단계: hwpx 4종(xlsx는 다른 kind 대비)

export async function runSend(
  taskId: string,
  input: { step: number; subject: string; body: string; recipients?: string[] },
  ctx: TransitionCtx,
): Promise<void> {
  if (input.step !== 1 && input.step !== 2) {
    throw new NotImplementedError("3단계(최종 발송)는 후속 단계에서 지원합니다."); // F2
  }
  const map = STEP_MAP[input.step];

  const task = await findTaskForSend(taskId);
  if (!task) throw new ForbiddenError("작업을 찾을 수 없습니다.");
  if (!can(ctx, KIND_RESOURCE[task.kind], "send")) {
    throw new ForbiddenError(`${KIND_RESOURCE[task.kind]}:send 권한이 없습니다.`);
  }

  // 수신자 해석(I1): 입력 우선 → task → type 기본. 빈 결과면 MailDelivery 생성 전 거부.
  const recipients =
    (input.recipients?.length ? input.recipients : null) ?? task.recipients ?? task.defaultRecipients ?? [];
  if (recipients.length === 0) {
    throw new ConflictError("수신자가 없습니다. 수신자를 지정해 발송하세요.");
  }

  // 첨부 산출(spec §9.1): step1=outputPath 디렉터리 내 hwpx/xlsx, step2=없음.
  let attachments: Array<{ filename: string; path: string }> = [];
  if (map.attach) {
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
    msg: { to: recipients, subject: input.subject, html: input.body, attachments },
    sentById: ctx.userId,
    expectedTaskStatus: map.from,
    onDelivered: { fromStatus: map.from, toStatus: map.to, actorId: ctx.userId },
  });
}
