# Task 09 — mail/cancel 동시성 적응 (가드·G2b·H1·D8·I4)

**Purpose:** foundation의 send/cancel 상호배제를 완성하고 메일 첨부를 storage-relative strict로 일원화한다 — cancel 원자 술어(H1), createSendingDelivery task-status 가드(D11), finalize+transition 한 tx(G2b), deliver/retry 첨부 strict(D8·I4). leave는 workflows mail service/repo를 쓰지 않으므로 무영향(자체 워커 repo)(spec §9.2.1·§9.3).

## Files

- **Modify:** `src/modules/workflows/repositories/index.ts` — `cancelTaskAtomic` 추가(H1)
- **Modify:** `src/modules/workflows/repositories/mail.ts` — `createSendingDelivery` task-status 가드(D11), `finalizeDeliveryWithTransition` 추가(G2b)
- **Modify:** `src/modules/workflows/services/lifecycle.ts` — `transitionTask`의 CANCELLED 경로를 `cancelTaskAtomic`로(H1)
- **Modify:** `src/modules/workflows/services/mail.ts` — `deliver`(첨부 toStoredOutputPath + `onDelivered` G2b), `retryDelivery`(resolveStoragePath strict, I4)
- **Modify (test):** `tests/modules/workflows/mail-service.test.ts` — retry 첨부를 상대경로로 + storage mock + 절대경로 거부 케이스
- **Create (test):** `tests/modules/workflows/cancel-atomic.test.ts`

## Prep

- 읽기: spec §9.2.1(H1)·§9.2 step 3(D11)·step 5(G2b)·§9.3(D8·I4), entrypoint §Shared Contracts SC-2·SC-9.
- 확인된 사실: ① leave는 `src/modules/leave/repositories/mail`(워커: `listDueDeliveryIds`/`claimDelivery`/…)를 쓰고 **workflows의 `deliver`/`createSendingDelivery`/`retryDelivery`를 호출하지 않는다** → 이 task 변경은 leave 무영향. ② `transitionTask`는 `cancelTask`만 호출하고, 외부 직접 호출처 없음. ③ multiSchema raw SQL은 `workflows."WorkflowTask"`/`workflows."MailDelivery"`로 스키마 한정.
- 의존: task-01(`resolveStoragePath`/`toStoredOutputPath`).

## Deps

01.

## TDD steps

### 1. cancel 원자 술어 — `src/modules/workflows/repositories/index.ts`

(상단 import는 task-08에서 `ConflictError`·`WorkflowTask`를 이미 추가했다고 가정. 미추가면 함께 추가.) 파일 끝에 추가:

```ts
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
```

### 2. lifecycle cancel 경로 교체 — `src/modules/workflows/services/lifecycle.ts`

import에서 `hasActiveSending` 제거하고 `cancelTaskAtomic` 추가:

```ts
import {
  findTaskForTransition,
  findWorkflowTypeKind,
  createTaskWithInitialEvent,
  applyTransitionAtomic,
  cancelTaskAtomic,
} from "../repositories";
```

`transitionTask`의 CANCELLED 블록을 교체(기존 `hasActiveSending` precheck + 공용 `applyTransitionAtomic` 대신 원자 술어):

```ts
  if (to === "CANCELLED") {
    if (!ctx.isOwner && task.createdById !== ctx.userId) {
      throw new ForbiddenError("본인 또는 관리자만 취소할 수 있습니다.");
    }
    // H1: 원자 술어(GENERATED는 ¬active-SENDING 포함). 비원자 hasActiveSending precheck 제거.
    const ok = await cancelTaskAtomic(taskId, task.status, ctx.userId, ctx.note);
    if (!ok) throw new ConflictError();
    return;
  }
```

(이후 `stampField`/`applyTransitionAtomic` 블록은 그대로 — CANCELLED 외 전이용. `cancelTask`는 변경 없이 `transitionTask(taskId,"CANCELLED",ctx)` 호출 → 이제 원자 술어 경유. `hasActiveSending` repo 함수는 남긴다 — 기존 repo 테스트 보호.)

### 3. createSendingDelivery task-status 가드 — `src/modules/workflows/repositories/mail.ts`

import에 `WorkflowStatus` 추가하고, `createSendingDelivery` 시그니처·tx에 가드 추가:

```ts
import type { MailDelivery, MailDeliveryStatus, WorkflowKind, WorkflowStatus } from "@prisma/client";

export async function createSendingDelivery(args: {
  taskId: string | null; step: string | null; recipients: string[]; subject: string;
  bodyHtml: string; attachmentPaths: string[]; sentById: string;
  expectedTaskStatus?: WorkflowStatus; // D11: task가 이 status일 때만 SENDING 생성(cancel과 상호배제)
}): Promise<MailDelivery> {
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
        if (args.expectedTaskStatus != null) {
          // D11: task 행 잠금(FOR UPDATE) + status 가드 → cancel(H1)의 조건부 UPDATE와 같은 행에서 직렬화.
          const rows = await tx.$queryRaw<Array<{ status: WorkflowStatus }>>`
            SELECT status FROM workflows."WorkflowTask" WHERE id = ${args.taskId} FOR UPDATE`;
          if (rows.length === 0 || rows[0].status !== args.expectedTaskStatus) {
            throw new ConflictError("작업 상태가 발송 가능 상태가 아닙니다.");
          }
        }
      }
      return tx.mailDelivery.create({
        data: {
          taskId: args.taskId, step: args.step, status: "SENDING",
          recipients: args.recipients, subject: args.subject, bodyHtml: args.bodyHtml,
          attachmentPaths: args.attachmentPaths, sentById: args.sentById, sentAt: null,
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
```

### 4. finalize+transition 한 tx — `src/modules/workflows/repositories/mail.ts`

파일 끝에 추가(`finalizeDelivery` 아래):

```ts
// G2b: SMTP 성공 후 finalize(SENT)+task 전이를 한 tx로. SENDING이 이 tx 직전까지 유지되므로
// "delivery=SENT인데 task 미전이" cancel 침투 창이 없다. SENT 전이만 sentAt stamp(STAMP_FOR_STATUS).
export async function finalizeDeliveryWithTransition(
  deliveryId: string,
  patch: { providerMessageId: string | null },
  transition: { taskId: string; fromStatus: WorkflowStatus; toStatus: WorkflowStatus; actorId: string },
): Promise<MailDelivery> {
  await prisma.$transaction(async (tx: PrismaTx) => {
    const fin = await tx.mailDelivery.updateMany({
      where: { id: deliveryId, status: "SENDING" },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: patch.providerMessageId, errorMessage: null },
    });
    if (fin.count !== 1) throw new ConflictError("발송이 이미 다른 경로에서 확정되었습니다.");
    const trans = await tx.workflowTask.updateMany({
      where: { id: transition.taskId, status: transition.fromStatus },
      data: transition.toStatus === "SENT" ? { status: "SENT", sentAt: new Date() } : { status: transition.toStatus },
    });
    if (trans.count === 0) throw new ConflictError("작업 상태가 이미 변경되었습니다.");
    await tx.workflowTaskEvent.create({
      data: { taskId: transition.taskId, fromStatus: transition.fromStatus, toStatus: transition.toStatus, actorId: transition.actorId },
    });
  });
  return prisma.mailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
}
```

### 5. deliver/retry 적응 — `src/modules/workflows/services/mail.ts`

import 추가:

```ts
import type { WorkflowStatus } from "@prisma/client";
import { resolveStoragePath, toStoredOutputPath } from "@/lib/storage";
import { claimFailedForRetry, createSendingDelivery, finalizeDelivery, finalizeDeliveryWithTransition, findDeliveryForAction } from "../repositories/mail";
```

`deliver`를 교체(첨부 storage-relative 저장 D8·I4 + 선택적 전이 G2b + status 가드 D11):

```ts
export async function deliver(args: {
  taskId: string | null; step: string | null; msg: MailMessage; sentById: string;
  expectedTaskStatus?: WorkflowStatus; // D11
  onDelivered?: { fromStatus: WorkflowStatus; toStatus: WorkflowStatus; actorId: string }; // G2b
}): Promise<MailDelivery> {
  const record = await createSendingDelivery({
    taskId: args.taskId,
    step: args.step,
    recipients: args.msg.to,
    subject: args.msg.subject,
    bodyHtml: args.msg.html,
    // D8·I4: 첨부 절대경로 → storage-relative로 저장(out 밖이면 throw). 빈 배열이면 그대로 []( leave/무첨부 무영향).
    attachmentPaths: (args.msg.attachments ?? []).map((a) => toStoredOutputPath(a.path)),
    sentById: args.sentById,
    expectedTaskStatus: args.expectedTaskStatus,
  });

  const smtpConfig = await getSmtpConfig();
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
```

`retryDelivery`의 첨부 처리 블록을 교체(절대 가정 → strict resolve, I4):

```ts
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
  return finalizeDelivery(d.id, { status: "SENT", sentAt: new Date(), providerMessageId });
```

### 6. 기존 mail-service.test.ts 수정 (I4 — 절대경로 첨부 → 상대 + storage mock)

상단 mock 블록에 storage 추가:

```ts
vi.mock("@/lib/storage", () => ({
  resolveStoragePath: vi.fn((p: string) => {
    if (p.startsWith("out/") || p.startsWith("Template/")) return `/abs/${p}`;
    throw new Error("strict: 절대경로/허용 안 된 경로");
  }),
  toStoredOutputPath: vi.fn((abs: string) => abs.replace("/abs/", "")),
}));
```

`retryDelivery` describe의 `failed` fixture에서 `attachmentPaths: ["/o/a.pdf"]` → `attachmentPaths: ["out/workflows/t1/a.hwpx"]`로 변경. (나머지 retry 테스트는 그대로 통과 — resolveStoragePath가 상대→/abs/.)

retry describe에 신규 테스트 추가(I4 핵심):

```ts
  it("절대경로 첨부 row → retry 거부(I4, exfiltration 차단)", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...failed, attachmentPaths: ["/etc/passwd"] });
    const out = await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }));
    expect(send).not.toHaveBeenCalled();
    expect((out as any).status).toBe("FAILED");
  });
```

(`@/modules/workflows/repositories/mail` mock에 `finalizeDeliveryWithTransition: vi.fn()`도 추가 — deliver 테스트에서 onDelivered 미사용이라 호출 안 되지만 import 해소를 위해.)

### 7. 신규 cancel 테스트 — `tests/modules/workflows/cancel-atomic.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const tx = { $executeRaw: vi.fn(), workflowTask: { updateMany: vi.fn() }, workflowTaskEvent: { create: vi.fn() } };
  return { prisma: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)), __tx: tx } };
});

import { prisma } from "@/lib/prisma";
import { cancelTaskAtomic } from "@/modules/workflows/repositories";

const tx = (prisma as unknown as { __tx: { $executeRaw: ReturnType<typeof vi.fn>; workflowTask: { updateMany: ReturnType<typeof vi.fn> }; workflowTaskEvent: { create: ReturnType<typeof vi.fn> } } }).__tx;

beforeEach(() => { tx.$executeRaw.mockReset(); tx.workflowTask.updateMany.mockReset(); tx.workflowTaskEvent.create.mockReset(); });

describe("cancelTaskAtomic (H1)", () => {
  it("GENERATED: 조건부 UPDATE 1행 → 이벤트 기록 + true", async () => {
    tx.$executeRaw.mockResolvedValue(1);
    expect(await cancelTaskAtomic("t1", "GENERATED", "u1")).toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.workflowTaskEvent.create).toHaveBeenCalled();
  });
  it("GENERATED but SENDING 존재 → 0행 → false(이벤트 없음, 발송된 작업 보호)", async () => {
    tx.$executeRaw.mockResolvedValue(0);
    expect(await cancelTaskAtomic("t1", "GENERATED", "u1")).toBe(false);
    expect(tx.workflowTaskEvent.create).not.toHaveBeenCalled();
  });
  it("PENDING: 일반 status CAS(updateMany), SENDING 검사 없음", async () => {
    tx.workflowTask.updateMany.mockResolvedValue({ count: 1 });
    expect(await cancelTaskAtomic("t1", "PENDING", "u1")).toBe(true);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.workflowTask.updateMany).toHaveBeenCalled();
  });
});
```

### 8. 실행 → PASS

```bash
npm test -- tests/modules/workflows/cancel-atomic.test.ts tests/modules/workflows/mail-service.test.ts
```

### 9. commit

```bash
git add src/modules/workflows/repositories/index.ts src/modules/workflows/repositories/mail.ts src/modules/workflows/services/lifecycle.ts src/modules/workflows/services/mail.ts tests/modules/workflows/cancel-atomic.test.ts tests/modules/workflows/mail-service.test.ts
git commit -m "feat(workflows): send/cancel 원자 상호배제(H1·D11·G2b) + 첨부 strict(D8·I4)"
```

## Acceptance Criteria

- `cancel-atomic.test.ts` + `mail-service.test.ts`(수정) 전건 PASS.
- `npm run typecheck` / `npm run lint`(boundaries — mail.ts는 `@/lib/storage` 추가 import) / `npm test`(전체, 기존 `mail-repository.test.ts`·`lifecycle.test.ts` 포함) / `npm run build` 통과.
- leave 무영향: leave는 workflows mail service/repo를 호출하지 않는다(자체 워커). `mail-service.test.ts`의 빈-첨부 `deliver` 테스트가 무첨부 경로(leave 동형) 안전을 커버.

## Cautions

- **Don't** cancel의 SENDING 검사와 status CAS를 분리하지 말 것. Reason: precheck-후-CAS race로 발송된 작업이 CANCELLED된다(spec §9.2.1). 단일 조건부 UPDATE(`GENERATED ∧ NOT EXISTS SENDING`).
- **Don't** `createSendingDelivery`의 status 가드를 FOR UPDATE 없이 단순 `findUnique`로 하지 말 것. Reason: 읽기-후-insert race로 cancel과 상호배제가 깨진다. task 행을 FOR UPDATE로 잠가 cancel의 UPDATE와 같은 행에서 직렬화.
- **Don't** SMTP 성공 후 finalize+전이 tx가 실패했을 때 FAILED로 되돌리지 말 것. Reason: 메일은 이미 나갔다 — SENDING으로 남기고 에러 전파(admin resolve). G2b는 finalize와 전이만 한 tx, SMTP는 그 전.
- **Don't** raw SQL에서 테이블/enum을 스키마 미한정으로 쓰지 말 것. Reason: multiSchema — `workflows."WorkflowTask"`/`workflows."MailDelivery"`. enum 리터럴(`'CANCELLED'`)은 Postgres가 enum 컨텍스트에서 캐스팅하나, 실패 시 `'CANCELLED'::workflows."WorkflowStatus"` 명시.
- **Don't** `hasActiveSending` repo 함수를 삭제하지 말 것. Reason: 기존 repo 테스트가 의존할 수 있다. cancel은 더 이상 안 쓰지만 함수는 남긴다(내 변경이 만든 orphan 아님 — 의도적 보존).
