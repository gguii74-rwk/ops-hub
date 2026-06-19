# Task 03 — workflow-task repository (Prisma 직접)

`workflows/repositories/index.ts`에 워크플로 task/event/file의 Prisma 직접 조회·기록 함수를 만든다. 전이의 **원자성**(조건부 `updateMany` + 이벤트 기록 tx)을 이 계층이 소유한다.

## Files

- Create: `src/modules/workflows/repositories/index.ts`
- Create (test): `tests/modules/workflows/repository.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts **SC-4**(repository 시그니처 전체).
- 동시성 패턴 참고: `src/kernel/settings/repository.ts`(`prisma.$transaction` 콜백 + `updateMany` count 검사).
- 기존 직접 조회 패턴: `src/modules/calendar/repositories/index.ts`.
- Spec §5.2(조건부 업데이트 0행 처리), §4.3(stamp 컬럼).

## Deps

- Task 01(스키마 — `WorkflowTaskEvent`, `MailDelivery.status`), Task 02(`GeneratorResult` 타입).

## Step 1 — 실패 테스트

생성: `tests/modules/workflows/repository.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const calls: Record<string, any> = {};
  const ret: any = { findMany: [], findUnique: null, updateCount: 1, typeKind: null, count: 0 };
  const events: any[] = [];
  return { calls, ret, events };
});

vi.mock("@/lib/prisma", () => {
  const client: any = {
    workflowTask: {
      findMany: async (a: any) => ((h.calls.list = a), h.ret.findMany),
      findUnique: async (a: any) => ((h.calls.findUnique = a), h.ret.findUnique),
      updateMany: async (a: any) => ((h.calls.updateMany = a), { count: h.ret.updateCount }),
      create: async (a: any) => ((h.calls.taskCreate = a), { id: "new-task" }),
    },
    workflowType: { findUnique: async (a: any) => ((h.calls.typeFind = a), h.ret.typeKind ? { kind: h.ret.typeKind } : null) },
    workflowTaskEvent: { create: async (a: any) => (h.events.push(a.data), a.data) },
    generatedFile: { createMany: async (a: any) => ((h.calls.fileCreate = a), { count: a.data.length }) },
    mailDelivery: { count: async (a: any) => ((h.calls.mailCount = a), h.ret.count) },
    $transaction: async (fn: any) => fn(client),
  };
  return { prisma: client };
});

import {
  findTaskList,
  findTaskDetail,
  findTaskForTransition,
  findWorkflowTypeKind,
  createTaskWithInitialEvent,
  applyTransitionAtomic,
  createGeneratedFiles,
  hasActiveSending,
} from "@/modules/workflows/repositories";

beforeEach(() => {
  for (const k of Object.keys(h.calls)) delete h.calls[k];
  h.ret.findMany = [];
  h.ret.findUnique = null;
  h.ret.updateCount = 1;
  h.ret.typeKind = null;
  h.ret.count = 0;
  h.events.length = 0;
});

describe("findTaskList", () => {
  it("kinds가 비면 prisma 호출 없이 []", async () => {
    const out = await findTaskList({ kinds: [] });
    expect(out).toEqual([]);
    expect(h.calls.list).toBeUndefined();
  });

  it("type.kind in + status·범위 필터로 조회하고 매핑", async () => {
    h.ret.findMany = [{ id: "t1", scheduledAt: new Date("2026-06-12"), status: "PENDING", type: { kind: "WEEKLY_REPORT", name: "주간보고" } }];
    const out = await findTaskList({ kinds: ["WEEKLY_REPORT"], statuses: ["PENDING"], start: new Date("2026-06-01"), end: new Date("2026-07-01") });
    expect(out).toEqual([{ id: "t1", kind: "WEEKLY_REPORT", typeName: "주간보고", scheduledAt: new Date("2026-06-12"), status: "PENDING" }]);
    expect(h.calls.list.where.type).toEqual({ kind: { in: ["WEEKLY_REPORT"] } });
    expect(h.calls.list.where.status).toEqual({ in: ["PENDING"] });
    expect(h.calls.list.where.scheduledAt).toEqual({ gte: new Date("2026-06-01"), lt: new Date("2026-07-01") });
  });
});

describe("findTaskDetail", () => {
  it("없으면 null", async () => {
    h.ret.findUnique = null;
    expect(await findTaskDetail("nope")).toBeNull();
  });

  it("type·files·mail·events를 평탄화해 반환", async () => {
    h.ret.findUnique = {
      id: "t1", scheduledAt: new Date("2026-06-12"), status: "GENERATED", createdById: "u1", outputPath: null,
      type: { kind: "WEEKLY_REPORT", name: "주간보고" },
      files: [{ id: "f1", path: "/o/a.xlsx", displayName: "a.xlsx", mimeType: null, sizeBytes: 10n, createdAt: new Date("2026-06-12") }],
      mailDeliveries: [{ id: "m1", step: "send", recipients: ["a@x"], subject: "s", status: "SENT", errorMessage: null, providerMessageId: "pm1", sentAt: new Date("2026-06-12") }],
      events: [{ id: "e1", fromStatus: null, toStatus: "PENDING", actorId: "u1", note: null, occurredAt: new Date("2026-06-12") }],
    };
    const out = await findTaskDetail("t1");
    expect(out?.kind).toBe("WEEKLY_REPORT");
    expect(out?.typeName).toBe("주간보고");
    expect(out?.files[0].id).toBe("f1");
    expect(out?.mailDeliveries[0].status).toBe("SENT");
    expect(out?.events[0].toStatus).toBe("PENDING");
  });
});

describe("findTaskForTransition / findWorkflowTypeKind", () => {
  it("transition용 조회는 kind를 평탄화", async () => {
    h.ret.findUnique = { id: "t1", status: "PENDING", createdById: "u1", type: { kind: "BILLING" } };
    expect(await findTaskForTransition("t1")).toEqual({ id: "t1", status: "PENDING", createdById: "u1", kind: "BILLING" });
  });
  it("typeKind 조회: 있으면 kind, 없으면 null", async () => {
    h.ret.typeKind = "WEEKLY_REPORT";
    expect(await findWorkflowTypeKind("wf-weekly")).toBe("WEEKLY_REPORT");
    h.ret.typeKind = null;
    expect(await findWorkflowTypeKind("nope")).toBeNull();
  });
});

describe("createTaskWithInitialEvent", () => {
  it("task 생성 + 초기 이벤트(fromStatus=null,toStatus=PENDING)를 tx로 기록", async () => {
    const out = await createTaskWithInitialEvent({ typeId: "wf-weekly", scheduledAt: new Date("2026-06-20"), createdById: "u1" });
    expect(out).toEqual({ id: "new-task" });
    expect(h.calls.taskCreate.data).toMatchObject({ typeId: "wf-weekly", createdById: "u1", status: "PENDING" });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ taskId: "new-task", fromStatus: null, toStatus: "PENDING", actorId: "u1" });
  });
});

describe("applyTransitionAtomic", () => {
  it("1행 갱신 시 true + 이벤트 1건, stampField를 data에 반영", async () => {
    h.ret.updateCount = 1;
    const ok = await applyTransitionAtomic({ taskId: "t1", fromStatus: "PENDING", toStatus: "GENERATED", actorId: "u1", note: "gen", stampField: "generatedAt" });
    expect(ok).toBe(true);
    expect(h.calls.updateMany.where).toEqual({ id: "t1", status: "PENDING" });
    expect(h.calls.updateMany.data.status).toBe("GENERATED");
    expect(h.calls.updateMany.data.generatedAt).toBeInstanceOf(Date);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ fromStatus: "PENDING", toStatus: "GENERATED", actorId: "u1", note: "gen" });
  });

  it("0행 갱신(경합) 시 false + 이벤트 없음", async () => {
    h.ret.updateCount = 0;
    const ok = await applyTransitionAtomic({ taskId: "t1", fromStatus: "PENDING", toStatus: "GENERATED", actorId: "u1", stampField: "generatedAt" });
    expect(ok).toBe(false);
    expect(h.events).toHaveLength(0);
  });

  it("stampField=null이면 타임스탬프를 넣지 않는다", async () => {
    await applyTransitionAtomic({ taskId: "t1", fromStatus: "PENDING", toStatus: "CANCELLED", actorId: "u1", stampField: null });
    expect(h.calls.updateMany.data).toEqual({ status: "CANCELLED" });
  });
});

describe("createGeneratedFiles / hasActiveSending", () => {
  it("빈 배열이면 prisma 호출 없음", async () => {
    await createGeneratedFiles("t1", []);
    expect(h.calls.fileCreate).toBeUndefined();
  });
  it("sizeBytes는 BigInt로 변환해 createMany", async () => {
    await createGeneratedFiles("t1", [{ path: "/o/a.xlsx", displayName: "a.xlsx", sizeBytes: 123 }]);
    expect(h.calls.fileCreate.data[0]).toMatchObject({ taskId: "t1", path: "/o/a.xlsx", displayName: "a.xlsx", sizeBytes: 123n, mimeType: null });
  });
  it("hasActiveSending: SENDING count>0 → true", async () => {
    h.ret.count = 2;
    expect(await hasActiveSending("t1")).toBe(true);
    expect(h.calls.mailCount.where).toEqual({ taskId: "t1", status: "SENDING" });
    h.ret.count = 0;
    expect(await hasActiveSending("t1")).toBe(false);
  });
});
```

## Step 2 — FAIL 확인

```bash
npm test -- tests/modules/workflows/repository.test.ts
```

## Step 3 — repositories/index.ts 구현

생성: `src/modules/workflows/repositories/index.ts`

```ts
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
```

## Step 4 — PASS

```bash
npm test -- tests/modules/workflows/repository.test.ts
```

## Step 5 — commit

```bash
git add src/modules/workflows/repositories/index.ts tests/modules/workflows/repository.test.ts
git commit -m "feat(workflows): task repository (atomic transition, detail/list, file/sending)"
```

## Acceptance Criteria

```bash
npm run typecheck   # 통과
npm run lint        # 통과(Prisma는 repositories에서만 import)
npm test -- tests/modules/workflows/repository.test.ts   # PASS
```

## Cautions

- **`applyTransitionAtomic`의 `updateMany` where에서 `status: fromStatus`를 절대 빼지 말 것.** 이유: 이 조건이 낙관적 동시성의 핵심이다. 빼면 read-then-write LWW가 되어 경합 시 이중 전이·이중 이벤트가 생긴다(spec §5.2).
- **이벤트 기록을 updateMany 성공(count===1) 이후로만** 둘 것. 0행일 때 이벤트를 남기면 timeline이 거짓 전이를 보여준다.
- `hasActiveSending`은 `SENDING`만 센다 — `SENT`를 포함하면 정상 완료된 발송이 영구히 취소를 막는다.
- 권한·정책 판단을 repository에 넣지 말 것(서비스 책임). 여기는 데이터 접근만.
