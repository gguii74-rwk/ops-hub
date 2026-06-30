# Task 10 — runSend + send route (1·2단계)

**Purpose:** 단계별 발송 오케스트레이터를 신설한다 — 권한 게이트(fail-closed) → step ∈ {1,2}(3은 422, F2) → 수신자 해석(I1) → 단계별 첨부 산출(§9.1) → `deliver`(D11 가드 + G2b 전이). 일반 send 라우트 포함(spec §9).

## Files

- **Modify:** `src/modules/workflows/repositories/index.ts` — `findTaskForSend` 추가
- **Create:** `src/modules/workflows/services/send.ts` — `runSend`
- **Create:** `src/app/api/workflows/[id]/send/route.ts`
- **Create (test):** `tests/modules/workflows/run-send.test.ts`

## Prep

- 읽기: spec §9.1·§9.2·§9.4, entrypoint §Shared Contracts SC-8·SC-9.
- 의존: task-09(`deliver`의 `expectedTaskStatus`·`onDelivered`), task-01(`resolveStoragePath`).
- 첨부 규칙(SC-8): step1=GENERATED→SENT, `outputPath` 디렉터리 내 `.hwpx`(+`.xlsx`); step2=SENT→HQ_REQUESTED, **첨부 없음**. step3은 이 슬라이스 제외(F2).
- 수신자(I1): `input.recipients` → `task.recipients` → `type.defaultRecipients` 순. 결과가 비면 `MailDelivery` 생성 전 거부.

## Deps

01, 08, 09. (`NotImplementedError`는 task-08에서 `types.ts`에 추가·`mapError`에 422 매핑되므로 08 선행.)

## TDD steps

### 1. repo 추가 — `src/modules/workflows/repositories/index.ts`

파일 끝에 추가:

```ts
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
```

### 2. 실패 테스트 작성 — `tests/modules/workflows/run-send.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("node:fs", () => ({ readdirSync: vi.fn() }));
vi.mock("@/lib/storage", () => ({ resolveStoragePath: vi.fn((p: string) => `/abs/${p}`) }));
vi.mock("@/modules/workflows/repositories", () => ({ findTaskForSend: vi.fn() }));
vi.mock("@/modules/workflows/services/mail", () => ({ deliver: vi.fn() }));

import fs from "node:fs";
import { ForbiddenError } from "@/kernel/access";
import { ConflictError, NotImplementedError } from "@/modules/workflows/types";
import { findTaskForSend } from "@/modules/workflows/repositories";
import { deliver } from "@/modules/workflows/services/mail";
import { runSend } from "@/modules/workflows/services/send";

const findTask = findTaskForSend as unknown as ReturnType<typeof vi.fn>;
const deliverFn = deliver as unknown as ReturnType<typeof vi.fn>;
const readdir = fs.readdirSync as unknown as ReturnType<typeof vi.fn>;
const ctx = (keys: string[]) => ({ userId: "u1", isOwner: false, permissionKeys: new Set(keys) });
const baseTask = { id: "t1", status: "GENERATED", kind: "BILLING", outputPath: "out/workflows/t1", recipients: null, defaultRecipients: null };

beforeEach(() => {
  findTask.mockReset().mockResolvedValue(baseTask);
  deliverFn.mockReset().mockResolvedValue({ id: "d1", status: "SENT" });
  readdir.mockReset().mockReturnValue(["(공문)a.hwpx", "기성계.hwpx", "memo.txt"]);
});

describe("runSend (1·2단계, D7·D11·G2b·I1·F2)", () => {
  it("step 3 → NotImplementedError(422, F2)", async () => {
    await expect(runSend("t1", { step: 3, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]))).rejects.toBeInstanceOf(NotImplementedError);
  });
  it("task 없음 → Forbidden", async () => {
    findTask.mockResolvedValue(null);
    await expect(runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("send 권한 없으면 Forbidden(fail-closed)", async () => {
    await expect(runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:view"]))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("수신자 미해석(input/task/default 모두 없음) → Conflict, deliver 미호출(I1)", async () => {
    await expect(runSend("t1", { step: 1, subject: "s", body: "b" }, ctx(["workflows.billing:send"]))).rejects.toBeInstanceOf(ConflictError);
    expect(deliverFn).not.toHaveBeenCalled();
  });
  it("step1: hwpx만 첨부 + deliver(expectedTaskStatus=GENERATED, onDelivered→SENT)", async () => {
    await runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]));
    expect(deliverFn).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "t1", step: "1", expectedTaskStatus: "GENERATED",
      onDelivered: { fromStatus: "GENERATED", toStatus: "SENT", actorId: "u1" },
      msg: expect.objectContaining({
        to: ["a@x.com"],
        attachments: [
          { filename: "(공문)a.hwpx", path: "/abs/out/workflows/t1/(공문)a.hwpx" },
          { filename: "기성계.hwpx", path: "/abs/out/workflows/t1/기성계.hwpx" },
        ],
      }),
    }));
  });
  it("step2: 첨부 없음 + deliver(expectedTaskStatus=SENT, onDelivered→HQ_REQUESTED)", async () => {
    findTask.mockResolvedValue({ ...baseTask, status: "SENT" });
    await runSend("t1", { step: 2, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]));
    expect(deliverFn).toHaveBeenCalledWith(expect.objectContaining({
      step: "2", expectedTaskStatus: "SENT",
      onDelivered: { fromStatus: "SENT", toStatus: "HQ_REQUESTED", actorId: "u1" },
      msg: expect.objectContaining({ attachments: [] }),
    }));
    expect(readdir).not.toHaveBeenCalled();
  });
  it("step1 outputPath 없음 → Conflict", async () => {
    findTask.mockResolvedValue({ ...baseTask, outputPath: null });
    await expect(runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]))).rejects.toBeInstanceOf(ConflictError);
  });
  it("step1 디렉터리에 hwpx/xlsx 없음 → Conflict", async () => {
    readdir.mockReturnValue(["memo.txt"]);
    await expect(runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]))).rejects.toBeInstanceOf(ConflictError);
  });
  it("수신자 폴백: input 없으면 task.recipients 사용", async () => {
    findTask.mockResolvedValue({ ...baseTask, recipients: ["task@x.com"] });
    await runSend("t1", { step: 1, subject: "s", body: "b" }, ctx(["workflows.billing:send"]));
    expect(deliverFn).toHaveBeenCalledWith(expect.objectContaining({ msg: expect.objectContaining({ to: ["task@x.com"] }) }));
  });
});
```

### 3. 실행 → FAIL

```bash
npm test -- tests/modules/workflows/run-send.test.ts
```

### 4. orchestrator 구현 — `src/modules/workflows/services/send.ts`

```ts
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
    const absDir = resolveStoragePath(task.outputPath); // strict
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
```

### 5. 실행 → PASS

```bash
npm test -- tests/modules/workflows/run-send.test.ts
```

### 6. send route — `src/app/api/workflows/[id]/send/route.ts`

```ts
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { runSend } from "@/modules/workflows/services/send";
import { buildTransitionCtx, mapError } from "../../_shared";

// step ∈ {1,2}만 허용(3은 zod 거부 — F2). recipients는 이메일 배열(선택, 미지정 시 task/type 폴백).
const sendSchema = z.object({
  step: z.union([z.literal(1), z.literal(2)]),
  subject: z.string().min(1),
  body: z.string(),
  recipients: z.array(z.string().email()).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    const input = sendSchema.parse(await req.json());
    const summary = await getPermissionSummary(session.user.id);
    await runSend(id, input, buildTransitionCtx(session.user, summary));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e);
  }
}
```

### 7. commit

```bash
git add src/modules/workflows/repositories/index.ts src/modules/workflows/services/send.ts "src/app/api/workflows/[id]/send" tests/modules/workflows/run-send.test.ts
git commit -m "feat(workflows): runSend 1·2단계(첨부 규칙·수신자 해석·D11·G2b) + send route"
```

## Acceptance Criteria

- `npm test -- tests/modules/workflows/run-send.test.ts` 전건 PASS — step3 거부·권한·수신자 미해석·step1 첨부·step2 무첨부·outputPath 없음·폴백.
- `npm run typecheck` / `npm run lint`(boundaries) / `npm test`(전체) / `npm run build` 통과.

## Cautions

- **Don't** 2단계에 첨부를 넣지 말 것. Reason: spec §9.1 — 2단계(본사 서류요청)는 본문만, 첨부 없음. 누락되기 쉬운 함정.
- **Don't** 수신자 미해석 상태로 `deliver`를 호출하지 말 것. Reason: 빈/null 수신자로 SMTP 도달·오해성 발송 기록(I1). `MailDelivery` 생성 전 ConflictError.
- **Don't** step3을 처리하지 말 것. Reason: F2 — 업로드 artifact 계약이 없어 안전하게 구현 불가. zod(라우트)와 `NotImplementedError`(runSend) 양쪽에서 거부.
- **Don't** 첨부 경로를 raw `task.outputPath`로 readdir하지 말 것. Reason: storage-relative 포인터다. `resolveStoragePath`(strict)로 절대화해야 한다(F4).
- **Don't** `deliver`에 `onDelivered` 없이 호출하고 별도로 전이를 부르지 말 것. Reason: G2b — finalize와 전이가 분리되면 cancel 침투 창. `onDelivered`로 한 tx에 묶는다.
