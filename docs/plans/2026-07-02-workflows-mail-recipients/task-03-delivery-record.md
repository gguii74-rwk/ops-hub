# Task 03 — 발송 기록: deliver 정규화·cc/bcc 기록, retry envelope 재발송

`deliver`가 D10 정규화를 **기록 전** 적용해 "기록 = 실제 전송 envelope"를 보장하고, `MailDelivery`에 cc/bcc를 기록·재발송한다(D4).

## Files
- Modify: `src/modules/workflows/repositories/mail.ts` (`createSendingDelivery` cc/bcc, `DeliveryForAction`·`findDeliveryForAction` cc/bcc)
- Modify: `src/modules/workflows/services/mail.ts` (`deliver` 정규화·기록, `retryDelivery` 재발송)
- Test: `tests/modules/workflows/mail-repository.test.ts` (케이스 추가)
- Test: `tests/modules/workflows/mail-service.test.ts` (케이스 추가)

## Prep
- 엔트리포인트 §SC-4(normalizeEnvelope — task-02 산출), §SC-5(기록 계약).
- 참조: `tests/modules/workflows/mail-repository.test.ts`(prisma fake `h.calls/h.ret` 관례), `tests/modules/workflows/mail-service.test.ts`(repo·sendMail mock 관례).

## Deps
- Task 01(스키마 cc/bcc — prisma:generate 완료), Task 02(`normalizeEnvelope`).

## Cautions
- **Don't `createSendingDelivery`의 cc/bcc를 필수 인자로 만들지 마라.** Reason: 기존 호출·테스트(leave 경로 포함) 호환 — `cc?: string[]` 기본 `[]` 기록.
- **Don't 멱등 가드·D11 status 가드·G2b 트랜잭션 로직을 재배치하지 마라.** Reason: 동시성 불변식(billing-backend 적대검증 산출) — cc/bcc는 데이터 추가일 뿐.
- **Don't retry에서 정규화를 다시 계산해 기록을 덮어쓰지 마라.** Reason: D10 — 저장된 envelope가 원천(멱등이라 sendMail 방어 재적용은 무해하지만 DB 기록은 불변).
- **Don't deliver의 ConflictError(빈 to)를 createSendingDelivery 뒤로 미루지 마라.** Reason: 빈 envelope로 SENDING 행을 만들면 멱등 가드가 점유된 채 실패한다 — 기록 전 거부.

## TDD Steps

### 1. repository — 실패 테스트 먼저

`tests/modules/workflows/mail-repository.test.ts`의 `describe("createSendingDelivery")` 안에 추가:

```ts
  it("cc/bcc를 그대로 기록(D4)", async () => {
    await createSendingDelivery({ taskId: "t1", step: "send", recipients: ["a@x"], cc: ["b@x"], bcc: ["c@x"], subject: "s", bodyHtml: "h", attachmentPaths: [], sentById: "u1" });
    expect(h.calls.create.data).toMatchObject({ recipients: ["a@x"], cc: ["b@x"], bcc: ["c@x"] });
  });

  it("cc/bcc 미지정 → 빈 배열 기록(기존 호출자 호환)", async () => {
    await createSendingDelivery({ taskId: "t1", step: "send", recipients: ["a@x"], subject: "s", bodyHtml: "h", attachmentPaths: [], sentById: "u1" });
    expect(h.calls.create.data).toMatchObject({ cc: [], bcc: [] });
  });
```

`describe("findDeliveryForAction")`의 첫 케이스를 확장·추가:

```ts
  it("task→type.kind를 평탄화하고 recipients/cc/bcc/attachmentPaths를 배열로", async () => {
    h.ret.found = { id: "d1", taskId: "t1", step: "send", status: "FAILED", recipients: ["a@x"], cc: ["b@x"], bcc: ["c@x"], subject: "s", bodyHtml: "<p>h</p>", attachmentPaths: ["/o/a.pdf"], task: { type: { kind: "BILLING" } } };
    const out = await findDeliveryForAction("d1");
    expect(out).toMatchObject({ id: "d1", taskId: "t1", status: "FAILED", kind: "BILLING", recipients: ["a@x"], cc: ["b@x"], bcc: ["c@x"], attachmentPaths: ["/o/a.pdf"] });
  });
  it("기존 행(cc/bcc null) → []로 해석(호환)", async () => {
    h.ret.found = { id: "d1", taskId: "t1", step: "send", status: "FAILED", recipients: ["a@x"], cc: null, bcc: null, subject: "s", bodyHtml: null, attachmentPaths: [], task: null };
    const out = await findDeliveryForAction("d1");
    expect(out).toMatchObject({ cc: [], bcc: [], kind: null });
  });
```

(기존 "recipients/attachmentPaths를 배열로" 케이스는 위 확장 케이스로 대체한다.)

실행: `npm test -- tests/modules/workflows/mail-repository.test.ts` → **FAIL**.

### 2. repository 구현 — `src/modules/workflows/repositories/mail.ts`

`DeliveryForAction`에 필드 추가:

```ts
export interface DeliveryForAction {
  id: string; taskId: string | null; step: string | null; status: MailDeliveryStatus;
  recipients: string[]; cc: string[]; bcc: string[]; subject: string; bodyHtml: string | null; attachmentPaths: string[];
  kind: WorkflowKind | null;
}
```

`createSendingDelivery` args에 `cc?: string[]; bcc?: string[];` 추가(recipients 다음 줄), `tx.mailDelivery.create`의 `data`에:

```ts
          recipients: args.recipients,
          cc: args.cc ?? [],
          bcc: args.bcc ?? [],
```

`findDeliveryForAction`의 select에 `cc: true, bcc: true,` 추가(recipients 다음), 반환 매핑에:

```ts
    cc: Array.isArray(d.cc) ? (d.cc as string[]) : [],
    bcc: Array.isArray(d.bcc) ? (d.bcc as string[]) : [],
```

실행: `npm test -- tests/modules/workflows/mail-repository.test.ts` → **PASS**.

### 3. service — 실패 테스트 먼저

`tests/modules/workflows/mail-service.test.ts`의 mail lib mock(4행)을 실 정규화 포함으로 교체 — deliver가 normalizeEnvelope를 import하므로 mock 모듈이 함수를 제공해야 한다:

```ts
vi.mock("@/lib/integrations/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/mail")>();
  return { ...actual, sendMail: vi.fn() };
});
```

`describe("deliver")` 안에 추가:

```ts
  it("D10: 정규화를 기록 전에 적용 — 기록=전송 envelope(cc−to 교차 제외 포함)", async () => {
    await deliver({ taskId: "t1", step: "send", msg: { to: ["a@x", "A@x"], cc: ["a@x", "b@x"], bcc: ["b@x", "c@x"], subject: "s", html: "h" }, sentById: "u1" });
    expect(repo.createSendingDelivery).toHaveBeenCalledWith(expect.objectContaining({
      recipients: ["a@x"], cc: ["b@x"], bcc: ["c@x"],
    }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ["a@x"], cc: ["b@x"], bcc: ["c@x"] }), expect.anything());
  });

  it("정규화 후 to가 비면 ConflictError — SENDING 기록·SMTP 미발생(fail-closed)", async () => {
    await expect(
      deliver({ taskId: "t1", step: "send", msg: { to: ["  "], cc: ["b@x"], subject: "s", html: "h" }, sentById: "u1" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(repo.createSendingDelivery).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
```

`describe("retryDelivery")` 계열(파일 내 기존 retry describe)에 추가 — 기존 retry 케이스의 `findDeliveryForAction` mock 반환값에는 `cc: [], bcc: []`를 보강한다:

```ts
  it("저장된 cc/bcc envelope 그대로 재발송(D4 컬럼 소비)", async () => {
    repo.findDeliveryForAction.mockResolvedValue({
      id: "d1", taskId: "t1", step: "1", status: "FAILED", recipients: ["a@x"], cc: ["b@x"], bcc: ["c@x"],
      subject: "s", bodyHtml: "<p>h</p>", attachmentPaths: [], kind: "BILLING",
    });
    repo.claimFailedForRetry.mockResolvedValue(true);
    await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.billing:send"] }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ["a@x"], cc: ["b@x"], bcc: ["c@x"] }), expect.anything());
  });
```

실행: `npm test -- tests/modules/workflows/mail-service.test.ts` → **FAIL**.

### 4. service 구현 — `src/modules/workflows/services/mail.ts`

import 갱신:

```ts
import { normalizeEnvelope, sendMail, type MailMessage } from "@/lib/integrations/mail";
```

`deliver`의 `createSendingDelivery` 호출 앞에 정규화·가드를 넣고 기록·전송에 envelope를 쓴다:

```ts
  // D10: 정규화를 기록 전에 적용 — 기록 = 실제 전송 envelope(감사·재시도 원천). to가 비면 기록 없이 거부.
  const env = normalizeEnvelope({ to: args.msg.to, cc: args.msg.cc, bcc: args.msg.bcc });
  if (env.to.length === 0) throw new ConflictError("수신자가 없습니다. 수신자를 지정해 발송하세요.");
  const record = await createSendingDelivery({
    taskId: args.taskId,
    step: args.step,
    recipients: env.to,
    cc: env.cc,
    bcc: env.bcc,
    subject: args.msg.subject,
    bodyHtml: args.msg.html,
    // D8·I4: 첨부 절대경로 → storage-relative로 저장(out 밖이면 throw). 빈 배열이면 그대로 [](leave/무첨부 무영향).
    attachmentPaths: (args.msg.attachments ?? []).map((a) => toStoredOutputPath(a.path)),
    sentById: args.sentById,
    expectedTaskStatus: args.expectedTaskStatus,
  });
```

같은 함수의 `sendMail` 호출을 envelope 기준으로:

```ts
    ({ providerMessageId } = await sendMail({ ...args.msg, to: env.to, cc: env.cc, bcc: env.bcc }, smtpConfig));
```

`retryDelivery`의 `sendMail` 호출에 cc/bcc 추가:

```ts
    ({ providerMessageId } = await sendMail({
      to: d.recipients,
      cc: d.cc,
      bcc: d.bcc,
      subject: d.subject,
      html: d.bodyHtml ?? "",
      attachments: absPaths.map((p) => ({ filename: basename(p), path: p })),
    }, smtpConfig));
```

실행: `npm test -- tests/modules/workflows/mail-service.test.ts` → **PASS**.

### 5. 게이트 검증 + 커밋

```bash
npm run typecheck && npm run lint && npm test -- tests/modules/workflows/mail-repository.test.ts tests/modules/workflows/mail-service.test.ts tests/modules/leave
```

leave 스위트 green 필수(공용 `MailDelivery`·deliver 경로 회귀). 전부 green이면 위 Files만 stage해 커밋.

## Acceptance Criteria
- `npm run typecheck` / `npm run lint` → 통과.
- `npm test -- tests/modules/workflows/mail-repository.test.ts tests/modules/workflows/mail-service.test.ts` → 통과(기존 멱등·CAS·G2b 케이스 불변).
- `npm test -- tests/modules/leave` → 통과.
- deliver: 기록된 `recipients/cc/bcc` = sendMail에 전달된 값(교차 제외 반영). 빈 to는 기록 전 409 경로.
- retry: 저장된 cc/bcc가 재발송에 포함. 기존 행(cc/bcc null)도 재시도 가능([]).
