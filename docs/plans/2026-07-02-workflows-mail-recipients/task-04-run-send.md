# Task 04 — runSend 해석 체인 개정(D5) + send 라우트 cc/bcc

발송 해석 체인을 "입력(모달 명시) → `type.defaultRecipients[step]` → 거부"로 개정하고(`task.recipients` 미참조), send 라우트가 cc/bcc를 받는다.

## Files
- Modify: `src/modules/workflows/repositories/index.ts` (`TaskForSend`·`findTaskForSend` — recipients 제거·defaultRecipients 구조화)
- Modify: `src/modules/workflows/services/send.ts` (`runSend` 해석 체인·cc/bcc 전달)
- Modify: `src/app/api/workflows/[id]/send/route.ts` (zod cc/bcc)
- Test: `tests/modules/workflows/run-send.test.ts` (체인 케이스 교체)
- Test: `tests/app/api/workflows/send-route.test.ts` (신규 — 라우트 스키마 계약)

## Prep
- 엔트리포인트 §SC-2(`parseDefaultRecipients`·`DefaultRecipientsMap` — task-01 산출), §SC-6(체인 계약).
- 참조: `tests/modules/workflows/run-send.test.ts`(mock 관례 — `baseTask`), `tests/app/api/workflows/calendar-route.test.ts`(라우트 테스트 mock 관례).

## Deps
- Task 01(recipients.ts), Task 02(MailMessage cc/bcc 타입), Task 03(deliver가 cc/bcc 수용).

## Cautions
- **Don't `task.recipients`를 어떤 형태로든 폴백에 남기지 마라.** Reason: D5 — 死필드(쓰기 지점 없음). 컬럼은 보존하되 select·타입·체인에서 제거.
- **Don't 입력이 있을 때(to 비어있지 않음) 서버에서 defaults를 merge하지 마라.** Reason: D6 원칙 — 모달 명시 전송(화면 목록 = 실제 발송). 입력 envelope 그대로.
- **Don't 입력의 to가 비고 cc만 있을 때 cc를 defaults에 합치지 마라.** Reason: 체인은 "입력 전체 → 폴백 전체 → 거부" — 부분 merge는 화면과 발송의 불일치를 만든다. `input.recipients` 비면 입력 cc/bcc도 무시하고 폴백.
- **Don't 첨부 산출·전이(policy)·deliver 배선(expectedTaskStatus·onDelivered)을 바꾸지 마라.** Reason: 수신자 해석만 개정(surgical).

## TDD Steps

### 1. runSend — 실패 테스트 먼저

`tests/modules/workflows/run-send.test.ts` 수정:

`baseTask`(21행)를 새 구조로 교체:

```ts
const baseTask = { id: "t1", status: "GENERATED", kind: "BILLING", outputPath: "out/workflows/t1", defaultRecipients: null };
```

기존 케이스 중 `"수신자 폴백: input 없으면 task.recipients 사용"`(76~80행)을 **삭제**하고, 아래 케이스들로 대체·추가(describe 말미):

```ts
  it("수신자 폴백(D5): input 없으면 type.defaultRecipients[step]의 to/cc/bcc 사용", async () => {
    findTask.mockResolvedValue({
      ...baseTask,
      defaultRecipients: { "1": { to: ["t@x.com"], cc: ["c@x.com"], bcc: ["b@x.com"] } },
    });
    await runSend("t1", { step: 1, subject: "s", body: "b" }, ctx(["workflows.billing:send"]));
    expect(deliverFn).toHaveBeenCalledWith(expect.objectContaining({
      msg: expect.objectContaining({ to: ["t@x.com"], cc: ["c@x.com"], bcc: ["b@x.com"] }),
    }));
  });
  it("입력이 있으면 입력 envelope 그대로(D6 — defaults 무시, cc/bcc 기본 [])", async () => {
    findTask.mockResolvedValue({
      ...baseTask,
      defaultRecipients: { "1": { to: ["t@x.com"], cc: ["c@x.com"], bcc: [] } },
    });
    await runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["in@x.com"] }, ctx(["workflows.billing:send"]));
    expect(deliverFn).toHaveBeenCalledWith(expect.objectContaining({
      msg: expect.objectContaining({ to: ["in@x.com"], cc: [], bcc: [] }),
    }));
  });
  it("입력 cc/bcc 전달", async () => {
    await runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"], cc: ["c@x.com"], bcc: ["b@x.com"] }, ctx(["workflows.billing:send"]));
    expect(deliverFn).toHaveBeenCalledWith(expect.objectContaining({
      msg: expect.objectContaining({ to: ["a@x.com"], cc: ["c@x.com"], bcc: ["b@x.com"] }),
    }));
  });
  it("step에 세트가 없으면(다른 step만 존재) Conflict — cc/bcc만으론 발송 불가", async () => {
    findTask.mockResolvedValue({
      ...baseTask,
      defaultRecipients: { "2": { to: ["t@x.com"], cc: [], bcc: [] }, "1": { to: [], cc: ["c@x.com"], bcc: [] } },
    });
    await expect(runSend("t1", { step: 1, subject: "s", body: "b" }, ctx(["workflows.billing:send"]))).rejects.toBeInstanceOf(ConflictError);
    expect(deliverFn).not.toHaveBeenCalled();
  });
```

기존 케이스 `"수신자 미해석(input/task/default 모두 없음) → Conflict"`(40~43행)는 문구만 갱신: `"수신자 미해석(input·type[step] 모두 없음) → Conflict, deliver 미호출(D5)"` — 본문 불변(baseTask.defaultRecipients=null).

실행: `npm test -- tests/modules/workflows/run-send.test.ts` → **FAIL**.

### 2. 구현 — repository + service

`src/modules/workflows/repositories/index.ts`: import에 추가(파일 상단, 기존 import 뒤):

```ts
import { parseDefaultRecipients, type DefaultRecipientsMap } from "../recipients";
```

`TaskForSend`·`findTaskForSend`를 교체:

```ts
export interface TaskForSend {
  id: string; status: WorkflowStatus; kind: WorkflowKind; outputPath: string | null;
  // D5: task.recipients는 死필드(쓰기 지점 없음) — select·체인에서 제거(컬럼은 보존). 폴백은 type의 단계별 맵뿐.
  defaultRecipients: DefaultRecipientsMap | null;
}

export async function findTaskForSend(id: string): Promise<TaskForSend | null> {
  const t = await prisma.workflowTask.findUnique({
    where: { id },
    select: {
      id: true, status: true, outputPath: true,
      type: { select: { kind: true, defaultRecipients: true } },
    },
  });
  if (!t) return null;
  return {
    id: t.id, status: t.status, kind: t.type.kind, outputPath: t.outputPath,
    defaultRecipients: parseDefaultRecipients(t.type.defaultRecipients),
  };
}
```

`src/modules/workflows/services/send.ts`: `runSend` 시그니처·해석 블록을 교체:

```ts
export async function runSend(
  taskId: string,
  input: { step: number; subject: string; body: string; recipients?: string[]; cc?: string[]; bcc?: string[] },
  ctx: TransitionCtx,
): Promise<void> {
```

수신자 해석(기존 41~46행)을 교체:

```ts
  // 수신자 해석(D5): 입력(모달 명시 envelope) → type.defaultRecipients[step] → 거부. task.recipients 미참조(死필드).
  // 입력 여부는 to(recipients) 기준 — to 없이 cc/bcc만 온 입력은 폴백으로 처리(부분 merge 금지).
  const fallback = task.defaultRecipients?.[String(input.step)];
  const envelope = input.recipients?.length
    ? { to: input.recipients, cc: input.cc ?? [], bcc: input.bcc ?? [] }
    : { to: fallback?.to ?? [], cc: fallback?.cc ?? [], bcc: fallback?.bcc ?? [] };
  if (envelope.to.length === 0) {
    throw new ConflictError("수신자가 없습니다. 수신자를 지정해 발송하세요.");
  }
```

`deliver` 호출의 msg를 교체:

```ts
    msg: { to: envelope.to, cc: envelope.cc, bcc: envelope.bcc, subject: input.subject, html: input.body, attachments },
```

실행: `npm test -- tests/modules/workflows/run-send.test.ts` → **PASS**.

### 3. 라우트 — 실패 테스트 먼저

`tests/app/api/workflows/send-route.test.ts` 생성:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<unknown> => ({ user: { id: "u1", systemRole: "MEMBER" } })),
  getPermissionSummary: vi.fn(async () => ({ keys: ["workflows.billing:send"] as string[], isOwner: false, isAdmin: false })),
  runSend: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } },
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...args: unknown[]) => unknown)(...a),
}));
vi.mock("@/modules/workflows/services/send", () => ({
  runSend: (...a: unknown[]) => (h.runSend as (...args: unknown[]) => unknown)(...a),
}));

import { POST } from "@/app/api/workflows/[id]/send/route";

const req = (body: unknown) => new Request("http://t/api/workflows/t1/send", { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "t1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", systemRole: "MEMBER" } });
  h.getPermissionSummary.mockResolvedValue({ keys: ["workflows.billing:send"], isOwner: false, isAdmin: false });
  h.runSend.mockResolvedValue(undefined);
});

describe("POST /api/workflows/[id]/send — cc/bcc 스키마", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await POST(req({ step: 1, subject: "s", body: "b" }), params)).status).toBe(401);
  });
  it("cc/bcc 포함 입력을 runSend에 그대로 전달 → 200", async () => {
    const res = await POST(req({ step: 1, subject: "s", body: "b", recipients: ["a@x.com"], cc: ["c@x.com"], bcc: ["d@x.com"] }), params);
    expect(res.status).toBe(200);
    const [, input] = h.runSend.mock.calls[0] as unknown as [string, { cc?: string[]; bcc?: string[] }];
    expect(input.cc).toEqual(["c@x.com"]);
    expect(input.bcc).toEqual(["d@x.com"]);
  });
  it("cc/bcc 생략 허용(기존 계약 회귀)", async () => {
    expect((await POST(req({ step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }), params)).status).toBe(200);
  });
  it("cc에 비이메일 → 400", async () => {
    const res = await POST(req({ step: 1, subject: "s", body: "b", recipients: ["a@x.com"], cc: ["nope"] }), params);
    expect(res.status).toBe(400);
    expect(h.runSend).not.toHaveBeenCalled();
  });
  it("bcc에 비이메일 → 400", async () => {
    expect((await POST(req({ step: 1, subject: "s", body: "b", recipients: ["a@x.com"], bcc: ["nope"] }), params)).status).toBe(400);
  });
});
```

실행: `npm test -- tests/app/api/workflows/send-route.test.ts` → **FAIL**(스키마에 cc/bcc 없음 → strip되어 전달 안 됨).

### 4. 라우트 구현

`src/app/api/workflows/[id]/send/route.ts`의 `sendSchema`를 교체:

```ts
// step ∈ {1,2}만 허용(3은 zod 거부 — F2). recipients=to(선택, 미지정 시 type[step] 폴백 — D5). cc/bcc 선택(D14는 응답측).
const sendSchema = z.object({
  step: z.union([z.literal(1), z.literal(2)]),
  subject: z.string().min(1),
  body: z.string(),
  recipients: z.array(z.string().email()).optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
});
```

실행: `npm test -- tests/app/api/workflows/send-route.test.ts` → **PASS**.

### 5. 게이트 검증 + 커밋

```bash
npm run typecheck && npm run lint && npm test -- tests/modules/workflows/run-send.test.ts tests/app/api/workflows/send-route.test.ts tests/modules/workflows/repository.test.ts
```

`repository.test.ts`는 findTaskForSend를 직접 단언하지 않지만 파일 전체 회귀 확인. 전부 green이면 위 Files만 stage해 커밋.

## Acceptance Criteria
- `npm run typecheck` / `npm run lint` → 통과(특히 `TaskForSend`에서 recipients 참조 제거로 send.ts 컴파일).
- `npm test -- tests/modules/workflows/run-send.test.ts tests/app/api/workflows/send-route.test.ts` → 통과.
- runSend: 입력 우선(전체 envelope) / type[step] 폴백 / to 빈 거부 / `task.recipients` 미참조(코드 검색 `task.recipients` 0곳 — services/send.ts 기준).
- 라우트: cc/bcc 배열 email 검증(비이메일 400), 생략 허용.
