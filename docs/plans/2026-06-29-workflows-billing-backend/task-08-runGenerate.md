# Task 08 — runGenerate + registry + commit 전이 + generate route

**Purpose:** generate 오케스트레이터를 조립한다 — lease 직렬화(task-07) → 임시 디렉터리 생성(DB tx 밖, I2) → 원자 승격(G1·H2) → 짧은 commit tx(status CAS + 파일 + 이벤트 + billing round-date create-if-missing I3). kind 디스패치 레지스트리(D6)와 일반 generate 라우트 포함(spec §8).

## Files

- **Create:** `src/modules/workflows/services/generator-registry.ts` — `GENERATORS`·`getGenerator`
- **Create:** `src/modules/workflows/services/generate.ts` — `runGenerate`
- **Modify:** `src/modules/workflows/repositories/index.ts` — `findTaskForGenerate`·`commitGeneratedTransition` 추가
- **Modify:** `src/modules/workflows/types.ts` — `NotImplementedError` 추가
- **Modify:** `src/app/api/workflows/_shared.ts` — `mapError`에 `NotImplementedError`(422)
- **Create:** `src/app/api/workflows/[id]/generate/route.ts`
- **Create (test):** `tests/modules/workflows/run-generate.test.ts`

## Prep

- 읽기: spec §8(전체), entrypoint §Shared Contracts SC-3·SC-4·SC-9.
- 사실: `findTaskForTransition`(`repositories/index.ts`)은 `{id,status,createdById,kind}`만 — generate는 `WorkflowTask` 전체(`scheduledAt`)가 필요하므로 `findTaskForGenerate`를 새로 만든다. `applyTransitionAtomic`은 기존 generic 전이용 — generate는 파일·round-date를 한 tx에 묶어야 하므로 전용 `commitGeneratedTransition`을 만든다.
- 의존: task-07(lease), task-06(generator + GeneratorPort 계약), task-05(computeBillingPeriod), task-03(billingRoundDate repo는 commit tx에서 직접 tx.billingRoundDate 사용).

## Deps

03, 05, 06, 07.

## TDD steps

### 1. types/_shared 확장

`src/modules/workflows/types.ts` — `ConflictError` 아래에 추가:

```ts
/** 미등록 kind generator 등 미구현 경로 → API 422. */
export class NotImplementedError extends Error {
  constructor(message = "지원하지 않는 작업입니다.") {
    super(message);
    this.name = "NotImplementedError";
  }
}
```

`src/app/api/workflows/_shared.ts` — import에 `NotImplementedError` 추가하고 `mapError`에 한 줄:

```ts
import { ConflictError, NotImplementedError } from "@/modules/workflows/types";
// ...
export function mapError(error: unknown): NextResponse {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof ConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof NotImplementedError) return NextResponse.json({ error: error.message }, { status: 422 });
  throw error;
}
```

### 2. repo 확장 — `src/modules/workflows/repositories/index.ts`

import에 `WorkflowTask`·`ConflictError` 추가(상단):

```ts
import type { WorkflowKind, WorkflowStatus, MailDeliveryStatus, WorkflowTask } from "@prisma/client";
import { ConflictError } from "../types";
```

파일 끝에 추가:

```ts
export interface FullTaskForGenerate { task: WorkflowTask; kind: WorkflowKind; }

// generate용 전체 task + kind. generator.generate(task)에 WorkflowTask 전체를 넘겨야 한다.
export async function findTaskForGenerate(id: string): Promise<FullTaskForGenerate | null> {
  const t = await prisma.workflowTask.findUnique({
    where: { id },
    include: { type: { select: { kind: true } } },
  });
  if (!t) return null;
  const { type, ...task } = t;
  return { task, kind: type.kind };
}

// 짧은 최종 commit tx(spec §8.2 step 4): status CAS(PENDING→GENERATED) + 파일 기록 + 이벤트
// + (billing) round-date create-if-missing(I3, 기존 행 덮어쓰기 금지). FS I/O는 이 tx 밖에서 끝난 상태.
export async function commitGeneratedTransition(args: {
  taskId: string; actorId: string; outputPath: string;
  files: GeneratorResult["files"];
  roundDate?: { year: number; round: number; submitDate: Date };
}): Promise<void> {
  await prisma.$transaction(async (tx: PrismaTx) => {
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
      // I3: 성공 commit 경로에서만, 기존 행 덮어쓰기 금지(수동 보정 회차일 보호).
      const existing = await tx.billingRoundDate.findUnique({
        where: { year_round: { year: args.roundDate.year, round: args.roundDate.round } },
        select: { id: true },
      });
      if (!existing) {
        await tx.billingRoundDate.create({
          data: { year: args.roundDate.year, round: args.roundDate.round, submitDate: args.roundDate.submitDate },
        });
      }
    }
  });
}
```

### 3. registry — `src/modules/workflows/services/generator-registry.ts`

```ts
import "server-only";
import type { WorkflowKind } from "@prisma/client";
import type { GeneratorPort } from "../types";
import { NotImplementedError } from "../types";
import { billingGenerator } from "./billing-generator";

// kind 디스패치(D6). 후속 sub-project는 여기 등록만으로 generate/send/download 라우트 재사용.
export const GENERATORS: Partial<Record<WorkflowKind, GeneratorPort>> = {
  BILLING: billingGenerator,
};

export function getGenerator(kind: WorkflowKind): GeneratorPort {
  const g = GENERATORS[kind];
  if (!g) throw new NotImplementedError(`'${kind}' 생성기가 등록되지 않았습니다.`);
  return g;
}
```

### 4. 실패 테스트 작성 — `tests/modules/workflows/run-generate.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("node:crypto", () => ({ randomUUID: vi.fn(() => "req-1") }));
vi.mock("node:fs", () => ({ mkdirSync: vi.fn(), existsSync: vi.fn(() => false), renameSync: vi.fn(), rmSync: vi.fn() }));
vi.mock("@/lib/storage", () => ({ resolveOutputPath: vi.fn((rel: string) => `/abs/${rel}`) }));
vi.mock("@/modules/workflows/repositories/generation-lock", () => ({ acquireGenerationLease: vi.fn(), releaseGenerationLease: vi.fn() }));
vi.mock("@/modules/workflows/repositories", () => ({ findTaskForGenerate: vi.fn(), commitGeneratedTransition: vi.fn() }));
vi.mock("@/modules/workflows/services/generator-registry", () => ({ getGenerator: vi.fn() }));

import fs from "node:fs";
import { ForbiddenError } from "@/kernel/access";
import { ConflictError } from "@/modules/workflows/types";
import { acquireGenerationLease, releaseGenerationLease } from "@/modules/workflows/repositories/generation-lock";
import { findTaskForGenerate, commitGeneratedTransition } from "@/modules/workflows/repositories";
import { getGenerator } from "@/modules/workflows/services/generator-registry";
import { runGenerate } from "@/modules/workflows/services/generate";

const acquire = acquireGenerationLease as unknown as ReturnType<typeof vi.fn>;
const release = releaseGenerationLease as unknown as ReturnType<typeof vi.fn>;
const findTask = findTaskForGenerate as unknown as ReturnType<typeof vi.fn>;
const commit = commitGeneratedTransition as unknown as ReturnType<typeof vi.fn>;
const getGen = getGenerator as unknown as ReturnType<typeof vi.fn>;
const fsRename = fs.renameSync as unknown as ReturnType<typeof vi.fn>;
const fsRm = fs.rmSync as unknown as ReturnType<typeof vi.fn>;
const fsExists = fs.existsSync as unknown as ReturnType<typeof vi.fn>;

const ctx = (keys: string[], isOwner = false) => ({ userId: "u1", isOwner, permissionKeys: new Set(keys) });
const billingTask = { id: "t1", status: "PENDING", scheduledAt: new Date("2026-03-10T01:00:00Z") };
const gen = { generate: vi.fn(async () => ({ files: [{ path: "out/workflows/t1/a.hwpx", displayName: "a.hwpx" }] })) };

beforeEach(() => {
  [acquire, release, findTask, commit, getGen, fsRename, fsRm].forEach((f) => f.mockReset());
  fsExists.mockReset().mockReturnValue(false);
  acquire.mockResolvedValue(true);
  findTask.mockResolvedValue({ task: billingTask, kind: "BILLING" });
  getGen.mockReturnValue(gen);
  gen.generate.mockClear().mockResolvedValue({ files: [{ path: "out/workflows/t1/a.hwpx", displayName: "a.hwpx" }] });
  commit.mockResolvedValue(undefined);
});

describe("runGenerate (F1·G1·H2·I2·I3·J1)", () => {
  it("lease 실패 → 409(ConflictError), generator 미호출", async () => {
    acquire.mockResolvedValue(false);
    await expect(runGenerate("t1", ctx(["workflows.billing:generate"]))).rejects.toBeInstanceOf(ConflictError);
    expect(getGen).not.toHaveBeenCalled();
  });
  it("동시 2건: 1진행·1 409(lease가 직렬화) — spec §8.2 AC", async () => {
    acquire.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const [a, b] = await Promise.allSettled([
      runGenerate("t1", ctx(["workflows.billing:generate"])),
      runGenerate("t1", ctx(["workflows.billing:generate"])),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["fulfilled", "rejected"]);
  });
  it("권한 없으면 Forbidden + lease release", async () => {
    await expect(runGenerate("t1", ctx(["workflows.billing:view"]))).rejects.toBeInstanceOf(ForbiddenError);
    expect(release).toHaveBeenCalledWith("t1", "req-1");
  });
  it("status != PENDING → Conflict", async () => {
    findTask.mockResolvedValue({ task: { ...billingTask, status: "GENERATED" }, kind: "BILLING" });
    await expect(runGenerate("t1", ctx(["workflows.billing:generate"]))).rejects.toBeInstanceOf(ConflictError);
  });
  it("정상: generate → 승격(rename) → commit(billing roundDate 포함) → release", async () => {
    await runGenerate("t1", ctx(["workflows.billing:generate"]));
    expect(gen.generate).toHaveBeenCalledWith(billingTask, "/abs/workflows/.tmp/t1-req-1");
    expect(fsRename).toHaveBeenCalledWith("/abs/workflows/.tmp/t1-req-1", "/abs/workflows/t1");
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "t1", outputPath: "out/workflows/t1",
      roundDate: { year: 2026, round: 2, submitDate: billingTask.scheduledAt }, // KST 3/10 → 전월 2월
    }));
    expect(release).toHaveBeenCalledWith("t1", "req-1");
  });
  it("기존 final 있으면 trash 경유 원자 교체(rename 2회 + trash rm)", async () => {
    fsExists.mockReturnValue(true);
    await runGenerate("t1", ctx(["workflows.billing:generate"]));
    expect(fsRename).toHaveBeenCalledTimes(2);
    expect(fsRm).toHaveBeenCalled(); // trash 삭제
  });
  it("generate 실패 → tmp cleanup + 에러 전파 + release(commit 미호출)", async () => {
    gen.generate.mockRejectedValue(new Error("zip fail"));
    await expect(runGenerate("t1", ctx(["workflows.billing:generate"]))).rejects.toThrow("zip fail");
    expect(fsRm).toHaveBeenCalledWith("/abs/workflows/.tmp/t1-req-1", { recursive: true, force: true });
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });
  it("non-billing kind는 roundDate 없이 commit", async () => {
    findTask.mockResolvedValue({ task: { id: "t2", status: "PENDING", scheduledAt: new Date() }, kind: "WEEKLY_REPORT" });
    await runGenerate("t2", ctx(["workflows.weekly:generate"]));
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ roundDate: undefined }));
  });
});
```

### 5. 실행 → FAIL

```bash
npm test -- tests/modules/workflows/run-generate.test.ts
```

### 6. orchestrator 구현 — `src/modules/workflows/services/generate.ts`

```ts
import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { WorkflowKind } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { resolveOutputPath } from "@/lib/storage";
import { ConflictError, type TransitionCtx } from "../types";
import { KIND_RESOURCE } from "../policy";
import { getGenerator } from "./generator-registry";
import { acquireGenerationLease, releaseGenerationLease } from "../repositories/generation-lock";
import { findTaskForGenerate, commitGeneratedTransition } from "../repositories";
import { computeBillingPeriod } from "../billing/period";

function can(ctx: TransitionCtx, resource: string, action: string): boolean {
  return ctx.isOwner || ctx.permissionKeys.has(`${resource}:${action}`);
}

function safeRm(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
}

// 임시 디렉터리를 final로 원자 승격. 기존 final이 있으면 유니크 trash로 치운 뒤 교체(torn write 없음).
function promoteDir(tmpDir: string, finalDir: string): void {
  fs.mkdirSync(path.dirname(finalDir), { recursive: true });
  if (fs.existsSync(finalDir)) {
    const trash = resolveOutputPath(`workflows/.trash/${path.basename(finalDir)}-${randomUUID()}`);
    fs.mkdirSync(path.dirname(trash), { recursive: true });
    fs.renameSync(finalDir, trash);  // 기존 final → trash (atomic)
    fs.renameSync(tmpDir, finalDir);  // tmp → final (atomic)
    safeRm(trash);                    // trash 정리(실패해도 무해)
  } else {
    fs.renameSync(tmpDir, finalDir);
  }
}

function billingRoundDate(kind: WorkflowKind, scheduledAt: Date) {
  if (kind !== "BILLING") return undefined;
  const p = computeBillingPeriod(scheduledAt);
  return { year: p.projectYear, round: p.round, submitDate: p.billingDate };
}

// 일반 kind 디스패치 generate 오케스트레이터(spec §8.2). 권한·status·직렬화·승격·commit를 조립.
export async function runGenerate(taskId: string, ctx: TransitionCtx): Promise<void> {
  const reqId = randomUUID();
  // 0. lease 점유로 직렬화(J1). 실패면 동시 generate 진행 중 → 즉시 409(무한 대기 없음).
  if (!(await acquireGenerationLease(taskId, reqId))) {
    throw new ConflictError("이미 생성이 진행 중입니다.");
  }
  const tmpDir = resolveOutputPath(`workflows/.tmp/${taskId}-${reqId}`);
  const finalDir = resolveOutputPath(`workflows/${taskId}`);
  let promoted = false;
  try {
    // 1. task 로드 + 권한 + status. lease 덕에 승격하는 요청은 하나뿐.
    const found = await findTaskForGenerate(taskId);
    if (!found) throw new ForbiddenError("작업을 찾을 수 없습니다.");
    const { task, kind } = found;
    if (!can(ctx, KIND_RESOURCE[kind], "generate")) {
      throw new ForbiddenError(`${KIND_RESOURCE[kind]}:generate 권한이 없습니다.`);
    }
    if (task.status !== "PENDING") throw new ConflictError(`${task.status} 상태에서는 생성할 수 없습니다.`);

    // 2. 생성 — 요청별 임시 디렉터리(DB tx 밖, 순수 FS·zip). round-date는 여기서 안 건드림(I3).
    fs.mkdirSync(tmpDir, { recursive: true });
    const result = await getGenerator(kind).generate(task, tmpDir); // 정확히 1회

    // 3. 원자 승격(GENERATED는 파일 안착 후에만 — G1).
    promoteDir(tmpDir, finalDir);
    promoted = true;

    // 4. 짧은 commit tx: status CAS + 파일 + 이벤트 + (billing) round-date create-if-missing.
    await commitGeneratedTransition({
      taskId,
      actorId: ctx.userId,
      outputPath: `out/workflows/${taskId}`,
      files: result.files,
      roundDate: billingRoundDate(kind, task.scheduledAt),
    });
  } catch (e) {
    if (!promoted) safeRm(tmpDir); // 승격 전 실패만 tmp 정리. 승격 후 commit 실패는 final 유지(status PENDING, 재생성 복구 G1).
    throw e;
  } finally {
    await releaseGenerationLease(taskId, reqId);
  }
}
```

### 7. 실행 → PASS

```bash
npm test -- tests/modules/workflows/run-generate.test.ts
```

### 8. generate route — `src/app/api/workflows/[id]/generate/route.ts`

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { runGenerate } from "@/modules/workflows/services/generate";
import { buildTransitionCtx, mapError } from "../../_shared";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    const summary = await getPermissionSummary(session.user.id);
    await runGenerate(id, buildTransitionCtx(session.user, summary)); // 권한은 runGenerate 내부에서 kind별 게이트
    return NextResponse.json({ ok: true });
  } catch (e) { return mapError(e); }
}
```

### 9. commit

```bash
git add src/modules/workflows/services/generate.ts src/modules/workflows/services/generator-registry.ts src/modules/workflows/repositories/index.ts src/modules/workflows/types.ts src/app/api/workflows/_shared.ts "src/app/api/workflows/[id]/generate" tests/modules/workflows/run-generate.test.ts
git commit -m "feat(workflows): runGenerate(lease 직렬화·승격·commit tx) + registry + generate route"
```

## Acceptance Criteria

- `npm test -- tests/modules/workflows/run-generate.test.ts` 전건 PASS — lease 409·동시 1진행/1거부·권한·status·승격(신규/교체)·실패 cleanup·billing roundDate·non-billing.
- `npm run typecheck` / `npm run lint`(boundaries) / `npm test`(전체) / `npm run build` 통과.
- 복구성(G1) 명시: GENERATED는 승격 성공 후에만 set → "GENERATED인데 파일 없음" 미발생. 승격 후 commit 전 크래시는 status PENDING + 파일 최종 위치 → 재생성 복구.

## Cautions

- **Don't** generator.generate를 두 번 호출하지 말 것. Reason: HWPX zip을 두 번 만들어 낭비 + 두 결과 불일치. 정확히 1회, `result.files`를 commit에 전달(위 정리본).
- **Don't** lease 획득/FS/commit을 하나의 `$transaction`으로 감싸지 말 것. Reason: I2 위배(FS 동안 DB 커넥션 점유 → 풀 고갈). FS는 tx 밖, commit만 짧은 tx.
- **Don't** GENERATED를 승격 전에 set하지 말 것. Reason: G1 — 승격 실패 시 "GENERATED인데 파일 없음" 복구 불가. 반드시 승격 → commit 순서.
- **Don't** round-date를 generate 단계(step 2)에서 upsert하지 말 것. Reason: I3 — 실패한 generation이 수동 보정 회차일을 오염시킨다. 성공 commit tx 안에서 create-if-missing만.
- **Don't** 승격 후 commit 실패 시 finalDir를 지우지 말 것. Reason: G1 복구 — 파일은 최종 위치에 두고 status를 PENDING으로 남겨 재생성이 정상 진행. `safeRm`은 `!promoted`일 때 tmp만.
