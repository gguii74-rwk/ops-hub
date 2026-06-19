# Task 04 — lifecycle 전이 엔진 (transition/create/cancel)

선언적 정책을 소비해 fail-closed로 전이를 검증·기록하는 엔진. 권한·취소 게이트·경합(409)을 여기서 결정하고, 원자 기록은 repository에 위임한다.

## Files

- Create: `src/modules/workflows/services/lifecycle.ts`
- Create (test): `tests/modules/workflows/lifecycle.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts **SC-2**(`TransitionCtx`,`ConflictError`), **SC-3**(정책), **SC-4**(repo 시그니처), **SC-6**(service 시그니처).
- Spec §5.2(transitionTask 절차 1~5), §7(권한 키), access-control 우선순위(OWNER 허용 → 기본 거부).

## Deps

- Task 02(policy·types), Task 03(repository).

## Step 1 — 실패 테스트

생성: `tests/modules/workflows/lifecycle.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("@/modules/workflows/repositories", () => ({
  findTaskForTransition: vi.fn(),
  findWorkflowTypeKind: vi.fn(),
  createTaskWithInitialEvent: vi.fn(),
  applyTransitionAtomic: vi.fn(),
  hasActiveSending: vi.fn(),
}));

import { ForbiddenError } from "@/kernel/access";
import { ConflictError } from "@/modules/workflows/types";
import * as repo from "@/modules/workflows/repositories";
import { transitionTask, createTask, cancelTask } from "@/modules/workflows/services/lifecycle";

const m = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;
const baseCtx = (over: Partial<{ userId: string; isOwner: boolean; keys: string[]; note: string }> = {}) => ({
  userId: over.userId ?? "u1",
  isOwner: over.isOwner ?? false,
  permissionKeys: new Set(over.keys ?? []),
  note: over.note,
});

beforeEach(() => {
  for (const k of Object.keys(m)) m[k].mockReset();
  m.applyTransitionAtomic.mockResolvedValue(true);
  m.hasActiveSending.mockResolvedValue(false);
});

describe("transitionTask", () => {
  it("허용 전이 + 권한 보유 → applyTransitionAtomic을 stampField와 함께 호출", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "u1", kind: "WEEKLY_REPORT" });
    await transitionTask("t1", "GENERATED", baseCtx({ keys: ["workflows.weekly:generate"] }));
    expect(m.applyTransitionAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t1", fromStatus: "PENDING", toStatus: "GENERATED", actorId: "u1", stampField: "generatedAt" }),
    );
  });

  it("정책에 없는 전이 → ConflictError, applyTransitionAtomic 미호출", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "u1", kind: "WEEKLY_REPORT" });
    await expect(transitionTask("t1", "SENT", baseCtx({ keys: ["workflows.weekly:send"] }))).rejects.toBeInstanceOf(ConflictError);
    expect(m.applyTransitionAtomic).not.toHaveBeenCalled();
  });

  it("권한 없음 → ForbiddenError", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "u1", kind: "WEEKLY_REPORT" });
    await expect(transitionTask("t1", "GENERATED", baseCtx({ keys: [] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("OWNER는 권한 키 없이도 허용 전이 통과", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "GENERATED", createdById: "other", kind: "WEEKLY_REPORT" });
    await transitionTask("t1", "SENT", baseCtx({ isOwner: true }));
    expect(m.applyTransitionAtomic).toHaveBeenCalled();
  });

  it("취소: 본인이면 통과", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "u1", kind: "WEEKLY_REPORT" });
    await transitionTask("t1", "CANCELLED", baseCtx({ keys: ["workflows.weekly:view"] }));
    expect(m.applyTransitionAtomic).toHaveBeenCalledWith(expect.objectContaining({ toStatus: "CANCELLED", stampField: null }));
  });

  it("취소: 본인도 OWNER도 아니면 ForbiddenError", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "other", kind: "WEEKLY_REPORT" });
    await expect(transitionTask("t1", "CANCELLED", baseCtx({ keys: ["workflows.weekly:view"] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("취소: 활성 SENDING이 있으면 ConflictError", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "GENERATED", createdById: "u1", kind: "WEEKLY_REPORT" });
    m.hasActiveSending.mockResolvedValue(true);
    await expect(transitionTask("t1", "CANCELLED", baseCtx({ keys: ["workflows.weekly:view"] }))).rejects.toBeInstanceOf(ConflictError);
    expect(m.applyTransitionAtomic).not.toHaveBeenCalled();
  });

  it("경합(applyTransitionAtomic false) → ConflictError", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "u1", kind: "WEEKLY_REPORT" });
    m.applyTransitionAtomic.mockResolvedValue(false);
    await expect(transitionTask("t1", "GENERATED", baseCtx({ keys: ["workflows.weekly:generate"] }))).rejects.toBeInstanceOf(ConflictError);
  });

  it("작업 없음 → ForbiddenError", async () => {
    m.findTaskForTransition.mockResolvedValue(null);
    await expect(transitionTask("nope", "GENERATED", baseCtx({ keys: ["workflows.weekly:generate"] }))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("createTask", () => {
  it("알 수 없는 typeId → ForbiddenError", async () => {
    m.findWorkflowTypeKind.mockResolvedValue(null);
    await expect(createTask({ typeId: "x", scheduledAt: new Date() }, baseCtx({ keys: ["workflows.weekly:create"] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("create 권한 없음 → ForbiddenError", async () => {
    m.findWorkflowTypeKind.mockResolvedValue("WEEKLY_REPORT");
    await expect(createTask({ typeId: "wf-weekly", scheduledAt: new Date() }, baseCtx({ keys: [] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("권한 보유 → createTaskWithInitialEvent 호출", async () => {
    m.findWorkflowTypeKind.mockResolvedValue("WEEKLY_REPORT");
    m.createTaskWithInitialEvent.mockResolvedValue({ id: "new" });
    const out = await createTask({ typeId: "wf-weekly", scheduledAt: new Date("2026-06-20") }, baseCtx({ keys: ["workflows.weekly:create"] }));
    expect(out).toEqual({ id: "new" });
    expect(m.createTaskWithInitialEvent).toHaveBeenCalledWith({ typeId: "wf-weekly", scheduledAt: new Date("2026-06-20"), createdById: "u1" });
  });
});

describe("cancelTask", () => {
  it("transitionTask(CANCELLED)로 위임", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "u1", kind: "WEEKLY_REPORT" });
    await cancelTask("t1", baseCtx({ keys: ["workflows.weekly:view"] }));
    expect(m.applyTransitionAtomic).toHaveBeenCalledWith(expect.objectContaining({ toStatus: "CANCELLED" }));
  });
});
```

## Step 2 — FAIL 확인

```bash
npm test -- tests/modules/workflows/lifecycle.test.ts
```

## Step 3 — lifecycle.ts 구현

생성: `src/modules/workflows/services/lifecycle.ts`

```ts
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
  hasActiveSending,
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
    if (await hasActiveSending(taskId)) {
      throw new ConflictError("발송이 진행 중이라 취소할 수 없습니다.");
    }
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
```

## Step 4 — PASS

```bash
npm test -- tests/modules/workflows/lifecycle.test.ts
```

## Step 5 — commit

```bash
git add src/modules/workflows/services/lifecycle.ts tests/modules/workflows/lifecycle.test.ts
git commit -m "feat(workflows): lifecycle transition engine (policy+authz+atomic, fail-closed)"
```

## Acceptance Criteria

```bash
npm run typecheck   # 통과
npm run lint        # 통과
npm test -- tests/modules/workflows/lifecycle.test.ts   # PASS
```

## Cautions

- **권한 검사를 정책 검사보다 앞에 두지 말 것.** spec §5.2 순서(① 조회 → ② 정책 → ③ 권한 → ④ 취소 게이트 → ⑤ tx)를 지킨다. 정책 위반·경합은 `ConflictError`(409), 권한·취소 주체 위반은 `ForbiddenError`(403)로 구분된다.
- **generate/send 같은 부수효과 전이 라우트를 여기에 만들지 말 것.** 공통 기반은 `cancelTask`만 API로 노출한다. generate/send 전이는 워크플로 sub-project가 생성·발송 성공 후 `transitionTask`를 호출한다(spec §5.2 말미, §9).
- 취소 게이트(본인/OWNER + SENDING 없음)를 `transitionTask` 안에 둔다 — `cancelTask`는 위임만. 게이트를 우회하는 별도 경로를 만들지 말 것.
- 작업 미존재를 `ForbiddenError`(403, fail-closed)로 처리한다 — 라우트는 별도 404를 만들지 않는다(상세 조회는 Task 07 `getTaskDetailView`가 NotFound 처리).
