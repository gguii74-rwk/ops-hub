import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTx } from "@/lib/prisma";
import type { WorkflowKind, WorkflowStatus, MailDeliveryStatus, WorkflowTask } from "@prisma/client";
import type { GeneratorResult } from "../types";
import { ConflictError } from "../types";

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

// kind → typeId 해석(D12). WorkflowType.kind는 @unique라 1:1.
export async function findWorkflowTypeByKind(kind: WorkflowKind): Promise<{ id: string } | null> {
  return prisma.workflowType.findUnique({ where: { kind }, select: { id: true } });
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

// H1: cancel을 단일 조건부 UPDATE로 원자화. GENERATED는 ¬active-SENDING을 한 문장에 묶어
// send-측 SENDING 점유와 순서 무관 상호배제. PENDING 등은 SENDING 위험이 없어 일반 status CAS.
export async function cancelTaskAtomic(
  taskId: string, fromStatus: WorkflowStatus, actorId: string, note?: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx: PrismaTx) => {
    let affected: number;
    if (fromStatus === "GENERATED") {
      affected = await tx.$executeRaw`
        UPDATE workflows."WorkflowTask"
        SET status = 'CANCELLED', "updatedAt" = now()
        WHERE id = ${taskId} AND status = 'GENERATED'
          AND NOT EXISTS (
            SELECT 1 FROM workflows."MailDelivery"
            WHERE "taskId" = ${taskId} AND status = 'SENDING'
          )`;
    } else {
      const r = await tx.workflowTask.updateMany({ where: { id: taskId, status: fromStatus }, data: { status: "CANCELLED" } });
      affected = r.count;
    }
    if (affected === 0) return false;
    await tx.workflowTaskEvent.create({
      data: { taskId, fromStatus, toStatus: "CANCELLED", actorId, note: note ?? null },
    });
    return true;
  });
}

export interface FullTaskForGenerate { task: WorkflowTask; kind: WorkflowKind; }

// generate용 전체 task + kind. generator.generate(task, outDir)에 WorkflowTask 전체를 넘겨야 한다.
export async function findTaskForGenerate(id: string): Promise<FullTaskForGenerate | null> {
  const t = await prisma.workflowTask.findUnique({
    where: { id },
    include: { type: { select: { kind: true } } },
  });
  if (!t) return null;
  const { type, ...task } = t;
  return { task, kind: type.kind };
}

export interface TaskForSend {
  id: string; status: WorkflowStatus; kind: WorkflowKind; outputPath: string | null;
  recipients: string[] | null; defaultRecipients: string[] | null;
}

export async function findTaskForSend(id: string): Promise<TaskForSend | null> {
  const t = await prisma.workflowTask.findUnique({
    where: { id },
    select: {
      id: true, status: true, outputPath: true, recipients: true,
      type: { select: { kind: true, defaultRecipients: true } },
    },
  });
  if (!t) return null;
  return {
    id: t.id, status: t.status, kind: t.type.kind, outputPath: t.outputPath,
    recipients: Array.isArray(t.recipients) ? (t.recipients as string[]) : null,
    defaultRecipients: Array.isArray(t.type.defaultRecipients) ? (t.type.defaultRecipients as string[]) : null,
  };
}

// 짧은 최종 commit tx(spec §8.2 step 4): status CAS(PENDING→GENERATED) + 파일 기록 + 이벤트
// + (billing) round-date create-if-missing(I3, 기존 행 덮어쓰기 금지). FS I/O는 이 tx 밖에서 끝난 상태.
export interface GeneratedFileForDownload {
  id: string; taskId: string; path: string; displayName: string; mimeType: string | null; kind: WorkflowKind;
}
export async function findGeneratedFileForDownload(fileId: string): Promise<GeneratedFileForDownload | null> {
  const f = await prisma.generatedFile.findUnique({
    where: { id: fileId },
    select: { id: true, taskId: true, path: true, displayName: true, mimeType: true, task: { select: { type: { select: { kind: true } } } } },
  });
  if (!f) return null;
  return { id: f.id, taskId: f.taskId, path: f.path, displayName: f.displayName, mimeType: f.mimeType, kind: f.task.type.kind };
}

export interface TaskForDownload { outputPath: string | null; kind: WorkflowKind; }
export async function findTaskForDownload(id: string): Promise<TaskForDownload | null> {
  const t = await prisma.workflowTask.findUnique({
    where: { id },
    select: { outputPath: true, type: { select: { kind: true } } },
  });
  if (!t) return null;
  return { outputPath: t.outputPath, kind: t.type.kind };
}

export async function commitGeneratedTransition(args: {
  taskId: string; actorId: string; outputPath: string; holder: string;
  files: GeneratorResult["files"];
  roundDate?: { year: number; round: number; submitDate: Date };
}): Promise<void> {
  await prisma.$transaction(async (tx: PrismaTx) => {
    // lease 소유권 권위 가드: 생성 도중 lease가 steal당했으면(holder 불일치/소멸) 이 요청의 산출물은
    // 더 이상 권위가 아니므로 commit 금지(승자만 GeneratedFile/이벤트를 쓴다 — disk≠DB 분기 차단).
    // FOR UPDATE로 lock 행을 잠가 동시 acquire(steal)와 직렬화한다.
    const lockRows = await tx.$queryRaw<Array<{ holder: string }>>`
      SELECT "holder" FROM workflows."GenerationLock" WHERE "taskId" = ${args.taskId} FOR UPDATE`;
    if (lockRows.length === 0 || lockRows[0].holder !== args.holder) {
      throw new ConflictError("생성 lease를 더 이상 보유하지 않습니다.");
    }
    const res = await tx.workflowTask.updateMany({
      where: { id: args.taskId, status: "PENDING" },
      data: { status: "GENERATED", generatedAt: new Date(), outputPath: args.outputPath },
    });
    if (res.count === 0) throw new ConflictError("상태가 이미 변경되었습니다.");

    if (args.files.length > 0) {
      await tx.generatedFile.createMany({
        data: args.files.map((f) => ({
          taskId: args.taskId,
          path: f.path,
          displayName: f.displayName,
          mimeType: f.mimeType ?? null,
          sizeBytes: f.sizeBytes != null ? BigInt(f.sizeBytes) : null,
        })),
      });
    }

    await tx.workflowTaskEvent.create({
      data: { taskId: args.taskId, fromStatus: "PENDING", toStatus: "GENERATED", actorId: args.actorId },
    });

    if (args.roundDate) {
      // I3: 성공 commit 경로에서만 create-if-missing. ON CONFLICT DO NOTHING(skipDuplicates)으로 멱등·경합안전화 —
      // 기존 행(수동 보정 회차일)은 덮어쓰지 않고, 같은 year_round를 병렬 commit하는 다른 task가 있어도
      // P2002로 tx가 깨지지 않는다(check-then-create의 race 제거).
      await tx.billingRoundDate.createMany({
        data: [{ year: args.roundDate.year, round: args.roundDate.round, submitDate: args.roundDate.submitDate }],
        skipDuplicates: true,
      });
    }
  });
}
