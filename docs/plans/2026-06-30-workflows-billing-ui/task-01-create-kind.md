# Task 01 — 생성 API가 `kind`를 수용 (D12·F5)

작업 생성 API를 비결정적 `typeId` 대신 안정적 `kind` enum으로 받게 바꾼다. 서버가 `kind→WorkflowType`을 해석한다. 전이/상태머신은 불변.

## Files

- Modify: `src/modules/workflows/validations/index.ts` — `createTaskSchema`(typeId→kind)
- Modify: `src/modules/workflows/repositories/index.ts` — `findWorkflowTypeByKind` 추가
- Modify: `src/modules/workflows/services/lifecycle.ts` — `createTask({ kind, scheduledAt })`
- Modify: `src/app/api/workflows/route.ts` — `POST`가 `kind` 파싱·전달
- Modify (test): `tests/modules/workflows/lifecycle.test.ts` — createTask describe 블록
- Modify (test): `tests/app/api/workflows/routes.test.ts` — POST 본문 `kind`

## Prep

- 엔트리포인트 §SC-2 ②, §SC-3 숙지. `WorkflowType.kind`는 `@unique`(백엔드 J3) → `findUnique({ where:{ kind } })` 가능.
- `KIND_RESOURCE`(`policy.ts`): `BILLING → "workflows.billing"` 등. `WorkflowKind` = `WEEKLY_REPORT|BILLING|NOTIFICATION_BILLING`.

## Deps

없음.

## TDD steps

### Step 1 — lifecycle 단위 테스트를 새 계약으로 교체 (RED)

`tests/modules/workflows/lifecycle.test.ts`의 repo mock에 `findWorkflowTypeByKind`를 추가하고(기존 `findWorkflowTypeKind`는 남겨둬도 무방 — 다른 곳 미사용이면 제거 가능), `describe("createTask")` 블록을 통째 교체:

```ts
// (파일 상단 vi.mock("@/modules/workflows/repositories", ...) 객체에 한 줄 추가)
//   findWorkflowTypeByKind: vi.fn(),
```

```ts
describe("createTask", () => {
  it("create 권한 없음 → ForbiddenError (타입 해석 전에 차단)", async () => {
    await expect(
      createTask({ kind: "BILLING", scheduledAt: new Date() }, baseCtx({ keys: [] })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(m.findWorkflowTypeByKind).not.toHaveBeenCalled();
  });

  it("kind 해석 실패(타입 행 없음) → ForbiddenError", async () => {
    m.findWorkflowTypeByKind.mockResolvedValue(null);
    await expect(
      createTask({ kind: "BILLING", scheduledAt: new Date() }, baseCtx({ keys: ["workflows.billing:create"] })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("권한 보유 → kind→typeId 해석 후 createTaskWithInitialEvent 호출", async () => {
    m.findWorkflowTypeByKind.mockResolvedValue({ id: "billing" });
    m.createTaskWithInitialEvent.mockResolvedValue({ id: "new" });
    const out = await createTask(
      { kind: "BILLING", scheduledAt: new Date("2026-06-20") },
      baseCtx({ keys: ["workflows.billing:create"] }),
    );
    expect(out).toEqual({ id: "new" });
    expect(m.findWorkflowTypeByKind).toHaveBeenCalledWith("BILLING");
    expect(m.createTaskWithInitialEvent).toHaveBeenCalledWith({ typeId: "billing", scheduledAt: new Date("2026-06-20"), createdById: "u1" });
  });

  it("OWNER는 권한 키 없이도 통과", async () => {
    m.findWorkflowTypeByKind.mockResolvedValue({ id: "billing" });
    m.createTaskWithInitialEvent.mockResolvedValue({ id: "new" });
    await createTask({ kind: "BILLING", scheduledAt: new Date("2026-06-20") }, baseCtx({ isOwner: true }));
    expect(m.createTaskWithInitialEvent).toHaveBeenCalled();
  });
});
```

`beforeEach`에 mock reset이 `Object.keys(m)` 순회라 신규 mock도 자동 reset된다(추가 코드 불필요).

Run: `npm test -- tests/modules/workflows/lifecycle.test.ts` → **FAIL**(현 `createTask`는 `typeId`/`findWorkflowTypeKind` 사용).

### Step 2 — validations `createTaskSchema` 교체

`src/modules/workflows/validations/index.ts` 상단(기존 `createTaskSchema` 정의 교체):

```ts
import { z } from "zod";
import type { WorkflowStatus } from "@prisma/client";

const STATUS_VALUES = ["PENDING", "GENERATED", "REVIEWED", "SENT", "HQ_REQUESTED", "FINAL_SENT", "CANCELLED"] as const;

// 작업 생성은 비결정적 typeId(seed별 billing/wf-billing) 대신 안정적 kind enum을 받는다(D12).
const WORKFLOW_KINDS = ["WEEKLY_REPORT", "BILLING", "NOTIFICATION_BILLING"] as const;
export const createTaskSchema = z.object({
  kind: z.enum(WORKFLOW_KINDS),
  scheduledAt: z.string().min(1), // ISO 또는 YYYY-MM-DD. Date 변환·유효성은 라우트에서.
});
```

(나머지 `resolveSchema`·`parseStatusList`·billing 스키마는 그대로.)

### Step 3 — repository `findWorkflowTypeByKind` 추가

`src/modules/workflows/repositories/index.ts`의 기존 `findWorkflowTypeKind` 바로 아래에 추가(기존 함수는 남겨둔다 — 제거하면 다른 소비처 영향 검토 필요, 본 태스크 범위 밖):

```ts
// kind → typeId 해석(D12). WorkflowType.kind는 @unique라 1:1.
export async function findWorkflowTypeByKind(kind: WorkflowKind): Promise<{ id: string } | null> {
  return prisma.workflowType.findUnique({ where: { kind }, select: { id: true } });
}
```

### Step 4 — `createTask`를 kind 기반으로 교체

`src/modules/workflows/services/lifecycle.ts`:

- import에 `WorkflowKind` 추가, repo import에 `findWorkflowTypeByKind` 추가(기존 `findWorkflowTypeKind` import 줄은 제거):

```ts
import "server-only";
import type { WorkflowStatus, WorkflowKind } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { ConflictError, type TransitionCtx } from "../types";
import { TRANSITIONS, KIND_RESOURCE, ACTION_FOR_STATUS, STAMP_FOR_STATUS } from "../policy";
import {
  findTaskForTransition,
  findWorkflowTypeByKind,
  createTaskWithInitialEvent,
  applyTransitionAtomic,
  cancelTaskAtomic,
} from "../repositories";
```

- `createTask` 함수 교체(권한 선검사 → 타입 해석 순서, fail-closed):

```ts
export async function createTask(
  input: { kind: WorkflowKind; scheduledAt: Date },
  ctx: TransitionCtx,
): Promise<{ id: string }> {
  if (!can(ctx, KIND_RESOURCE[input.kind], "create")) {
    throw new ForbiddenError(`${KIND_RESOURCE[input.kind]}:create 권한이 없습니다.`);
  }
  const type = await findWorkflowTypeByKind(input.kind);
  if (!type) throw new ForbiddenError("알 수 없는 워크플로 종류입니다.");
  return createTaskWithInitialEvent({ typeId: type.id, scheduledAt: input.scheduledAt, createdById: ctx.userId });
}
```

Run: `npm test -- tests/modules/workflows/lifecycle.test.ts` → **PASS**.

### Step 5 — route POST가 `kind` 전달

`src/app/api/workflows/route.ts` POST 내부, `createTask` 호출만 교체:

```ts
    const { id } = await createTask(
      { kind: parsed.data.kind, scheduledAt },
      buildTransitionCtx(session.user, summary),
    );
```

(`createTaskSchema.safeParse`·`scheduledAt` 변환 로직은 그대로 — 이제 `parsed.data.kind`가 enum.)

### Step 6 — routes 테스트 본문을 `kind`로 교체 (PASS)

`tests/app/api/workflows/routes.test.ts`의 `describe("POST /api/workflows")` 블록 교체:

```ts
describe("POST /api/workflows", () => {
  it("잘못된 입력(kind 누락) → 400", async () => {
    expect((await createPOST(req("/api/workflows", { scheduledAt: "2026-06-20T00:00:00.000Z" }))).status).toBe(400);
  });
  it("잘못된 kind enum → 400", async () => {
    expect((await createPOST(req("/api/workflows", { kind: "NOPE", scheduledAt: "2026-06-20T00:00:00.000Z" }))).status).toBe(400);
  });
  it("summary.isOwner=true면 ctx.isOwner=true로 createTask 호출, 201 (권위는 getPermissionSummary)", async () => {
    h.getPermissionSummary.mockResolvedValue({ keys: [], isOwner: true, isAdmin: true });
    h.setSession({ user: { id: "u1", systemRole: "OWNER", email: "o@x", name: "O", employmentType: "REGULAR", jobFunction: "PM" } });
    const res = await createPOST(req("/api/workflows", { kind: "BILLING", scheduledAt: "2026-06-20T00:00:00.000Z" }));
    expect(res.status).toBe(201);
    const ctxArg = (h.createTask.mock.calls[0] as unknown as [unknown, { isOwner: boolean }])[1];
    expect(ctxArg.isOwner).toBe(true);
  });
  it("must-change OWNER(summary.isOwner=false)면 session.systemRole=OWNER여도 ctx.isOwner=false — D17 우회 차단", async () => {
    h.getPermissionSummary.mockResolvedValue({ keys: [], isOwner: false, isAdmin: false });
    h.setSession({ user: { id: "u1", systemRole: "OWNER", email: "o@x", name: "O", employmentType: "REGULAR", jobFunction: "PM" } });
    const res = await createPOST(req("/api/workflows", { kind: "BILLING", scheduledAt: "2026-06-20T00:00:00.000Z" }));
    expect(res.status).toBe(201);
    const ctxArg = (h.createTask.mock.calls[0] as unknown as [unknown, { isOwner: boolean }])[1];
    expect(ctxArg.isOwner).toBe(false);
  });
  it("createTask ForbiddenError → 403", async () => {
    h.createTask.mockRejectedValue(new h.FakeForbidden("denied"));
    expect((await createPOST(req("/api/workflows", { kind: "BILLING", scheduledAt: "2026-06-20T00:00:00.000Z" }))).status).toBe(403);
  });
});
```

## Acceptance Criteria

- `npm test -- tests/modules/workflows/lifecycle.test.ts tests/app/api/workflows/routes.test.ts` → 전부 PASS.
- `npm run typecheck` → 0 errors (lifecycle 시그니처 변경 전파 확인).
- `npm run lint` → boundaries 위반 없음.
- 전체 `npm test`(`.env` 주입) → 회귀 0.

## Cautions

- **Don't** 권한 검사 전에 `findWorkflowTypeByKind`를 호출하지 말 것. 이유: authz 이전 DB 접근은 불필요하고, "권한 없음 → 타입 해석 전 차단" 테스트가 깨진다(fail-closed 순서).
- **Don't** `findWorkflowTypeKind`(기존, typeId→kind)를 제거하지 말 것 — 본 태스크 외 소비처 검토가 필요하고 범위 밖이다. 새 함수만 추가한다.
- **Don't** 전이/상태머신/`createTaskWithInitialEvent`(여전히 `typeId` 입력)를 바꾸지 말 것. kind→typeId 해석만 추가한다.
