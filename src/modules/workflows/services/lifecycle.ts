import "server-only";
import type { WorkflowStatus } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { ConflictError, type TransitionCtx } from "../types";
import { TRANSITIONS, KIND_RESOURCE, ACTION_FOR_STATUS, STAMP_FOR_STATUS } from "../policy";
import {
  findTaskForTransition,
  findWorkflowTypeKind,
  createTaskWithInitialEvent,
  applyTransitionAtomic,
  cancelTaskAtomic,
} from "../repositories";

function can(ctx: TransitionCtx, resource: string, action: string): boolean {
  return ctx.isOwner || ctx.permissionKeys.has(`${resource}:${action}`);
}

// fail-closed: 정책에 없는 전이·권한 없는 전이는 throw. 절차는 spec §5.2.
export async function transitionTask(taskId: string, to: WorkflowStatus, ctx: TransitionCtx): Promise<void> {
  const task = await findTaskForTransition(taskId);
  if (!task) throw new ForbiddenError("작업을 찾을 수 없습니다.");

  const allowed = TRANSITIONS[task.kind][task.status] ?? [];
  if (!allowed.includes(to)) throw new ConflictError(`${task.status}→${to} 전이는 허용되지 않습니다.`);

  const action = ACTION_FOR_STATUS[to];
  if (!action) throw new ForbiddenError("전이 액션이 정의되지 않았습니다.");
  if (!can(ctx, KIND_RESOURCE[task.kind], action)) {
    throw new ForbiddenError(`${KIND_RESOURCE[task.kind]}:${action} 권한이 없습니다.`);
  }

  if (to === "CANCELLED") {
    if (!ctx.isOwner && task.createdById !== ctx.userId) {
      throw new ForbiddenError("본인 또는 관리자만 취소할 수 있습니다.");
    }
    // H1: 원자 술어(GENERATED는 ¬active-SENDING 포함). 비원자 hasActiveSending precheck 제거.
    const ok = await cancelTaskAtomic(taskId, task.status, ctx.userId, ctx.note);
    if (!ok) throw new ConflictError();
    return;
  }

  const stampField = STAMP_FOR_STATUS[to] ?? null;
  const committed = await applyTransitionAtomic({
    taskId,
    fromStatus: task.status,
    toStatus: to,
    actorId: ctx.userId,
    note: ctx.note,
    stampField,
  });
  if (!committed) throw new ConflictError();
}

export async function createTask(
  input: { typeId: string; scheduledAt: Date },
  ctx: TransitionCtx,
): Promise<{ id: string }> {
  const kind = await findWorkflowTypeKind(input.typeId);
  if (!kind) throw new ForbiddenError("알 수 없는 워크플로 종류입니다.");
  if (!can(ctx, KIND_RESOURCE[kind], "create")) {
    throw new ForbiddenError(`${KIND_RESOURCE[kind]}:create 권한이 없습니다.`);
  }
  return createTaskWithInitialEvent({ typeId: input.typeId, scheduledAt: input.scheduledAt, createdById: ctx.userId });
}

export async function cancelTask(taskId: string, ctx: TransitionCtx): Promise<void> {
  await transitionTask(taskId, "CANCELLED", ctx);
}
