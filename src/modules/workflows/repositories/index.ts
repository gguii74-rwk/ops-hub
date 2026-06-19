import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTx } from "@/lib/prisma";
import type { WorkflowKind, WorkflowStatus, MailDeliveryStatus } from "@prisma/client";
import type { GeneratorResult } from "../types";

export interface TaskListRow { id: string; kind: WorkflowKind; typeName: string; scheduledAt: Date; status: WorkflowStatus; }
export interface TaskListFilter { kinds: WorkflowKind[]; statuses?: WorkflowStatus[]; start?: Date; end?: Date; }
export interface FileRow { id: string; path: string; displayName: string; mimeType: string | null; sizeBytes: bigint | null; createdAt: Date; }
export interface MailRow {
  id: string; step: string | null; recipients: unknown; subject: string;
  status: MailDeliveryStatus; errorMessage: string | null; providerMessageId: string | null; sentAt: Date | null;
}
export interface EventRow { id: string; fromStatus: WorkflowStatus | null; toStatus: WorkflowStatus; actorId: string | null; note: string | null; occurredAt: Date; }
export interface TaskDetailRow {
  id: string; kind: WorkflowKind; typeName: string; scheduledAt: Date; status: WorkflowStatus;
  createdById: string | null; outputPath: string | null;
  files: FileRow[]; mailDeliveries: MailRow[]; events: EventRow[];
}
export interface TaskForTransition { id: string; status: WorkflowStatus; createdById: string | null; kind: WorkflowKind; }

export async function findTaskList(filter: TaskListFilter): Promise<TaskListRow[]> {
  if (filter.kinds.length === 0) return [];
  const rows = await prisma.workflowTask.findMany({
    where: {
      type: { kind: { in: filter.kinds } },
      ...(filter.statuses && filter.statuses.length ? { status: { in: filter.statuses } } : {}),
      ...(filter.start || filter.end
        ? { scheduledAt: { ...(filter.start ? { gte: filter.start } : {}), ...(filter.end ? { lt: filter.end } : {}) } }
        : {}),
    },
    select: { id: true, scheduledAt: true, status: true, type: { select: { kind: true, name: true } } },
    orderBy: { scheduledAt: "desc" },
  });
  return rows.map((r) => ({ id: r.id, kind: r.type.kind, typeName: r.type.name, scheduledAt: r.scheduledAt, status: r.status }));
}

export async function findTaskDetail(id: string): Promise<TaskDetailRow | null> {
  const t = await prisma.workflowTask.findUnique({
    where: { id },
    select: {
      id: true, scheduledAt: true, status: true, createdById: true, outputPath: true,
      type: { select: { kind: true, name: true } },
      files: { select: { id: true, path: true, displayName: true, mimeType: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      mailDeliveries: {
        select: { id: true, step: true, recipients: true, subject: true, status: true, errorMessage: true, providerMessageId: true, sentAt: true },
        orderBy: { sentAt: "desc" },
      },
      events: { select: { id: true, fromStatus: true, toStatus: true, actorId: true, note: true, occurredAt: true }, orderBy: { occurredAt: "asc" } },
    },
  });
  if (!t) return null;
  return {
    id: t.id, kind: t.type.kind, typeName: t.type.name, scheduledAt: t.scheduledAt, status: t.status,
    createdById: t.createdById, outputPath: t.outputPath,
    files: t.files, mailDeliveries: t.mailDeliveries, events: t.events,
  };
}

export async function findTaskForTransition(id: string): Promise<TaskForTransition | null> {
  const t = await prisma.workflowTask.findUnique({
    where: { id },
    select: { id: true, status: true, createdById: true, type: { select: { kind: true } } },
  });
  return t ? { id: t.id, status: t.status, createdById: t.createdById, kind: t.type.kind } : null;
}

export async function findWorkflowTypeKind(typeId: string): Promise<WorkflowKind | null> {
  const t = await prisma.workflowType.findUnique({ where: { id: typeId }, select: { kind: true } });
  return t?.kind ?? null;
}

export async function createTaskWithInitialEvent(input: {
  typeId: string; scheduledAt: Date; createdById: string;
}): Promise<{ id: string }> {
  return prisma.$transaction(async (tx: PrismaTx) => {
    const task = await tx.workflowTask.create({
      data: { typeId: input.typeId, scheduledAt: input.scheduledAt, createdById: input.createdById, status: "PENDING" },
      select: { id: true },
    });
    await tx.workflowTaskEvent.create({
      data: { taskId: task.id, fromStatus: null, toStatus: "PENDING", actorId: input.createdById },
    });
    return { id: task.id };
  });
}

// 조건부·원자 전이. updateMany(where status=fromStatus)가 1행을 갱신했을 때만 이벤트를 기록한다.
// 0행이면(그 사이 상태 변경) false를 돌려 엔진이 ConflictError를 던지게 한다(§5.2).
export async function applyTransitionAtomic(args: {
  taskId: string; fromStatus: WorkflowStatus; toStatus: WorkflowStatus;
  actorId: string; note?: string; stampField: "generatedAt" | "reviewedAt" | "sentAt" | null;
}): Promise<boolean> {
  return prisma.$transaction(async (tx: PrismaTx) => {
    const now = new Date();
    const data: Prisma.WorkflowTaskUpdateManyMutationInput = { status: args.toStatus };
    if (args.stampField) data[args.stampField] = now; // stampField는 generatedAt|reviewedAt|sentAt 리터럴 — 모두 Date 허용
    const res = await tx.workflowTask.updateMany({ where: { id: args.taskId, status: args.fromStatus }, data });
    if (res.count === 0) return false;
    await tx.workflowTaskEvent.create({
      data: { taskId: args.taskId, fromStatus: args.fromStatus, toStatus: args.toStatus, actorId: args.actorId, note: args.note ?? null },
    });
    return true;
  });
}

export async function createGeneratedFiles(taskId: string, files: GeneratorResult["files"]): Promise<void> {
  if (files.length === 0) return;
  await prisma.generatedFile.createMany({
    data: files.map((f) => ({
      taskId,
      path: f.path,
      displayName: f.displayName,
      mimeType: f.mimeType ?? null,
      sizeBytes: f.sizeBytes != null ? BigInt(f.sizeBytes) : null,
    })),
  });
}

// cancel 게이트(§5.2): 진행 중(SENDING) 발송이 있으면 취소를 막는다(SENT는 완료라 비대상).
export async function hasActiveSending(taskId: string): Promise<boolean> {
  const n = await prisma.mailDelivery.count({ where: { taskId, status: "SENDING" } });
  return n > 0;
}
