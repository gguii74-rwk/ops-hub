# Task 04 — 메일 호출자 배선(leave · workflows)

**Purpose**: 두 mail 호출자가 `getSmtpConfig()`로 해석한 config를 `sendMail`에 주입하도록 배선한다. 이로써 DB의 port/fromAddress가 실제 전송에 반영된다(D1). `getSmtpConfig`는 throw하지 않으므로(D10) 이 await가 유효 env 발송을 막지 않는다.

## Files

- Modify `src/modules/leave/services/mail.ts`
- Modify `src/modules/workflows/services/mail.ts`
- Modify `tests/modules/leave/mail-drain.test.ts`
- Modify `tests/modules/workflows/mail-service.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts SC-2(`getSmtpConfig`), SC-3(`sendMail(msg, config?)`), SC-7(모듈→reader).
- spec §5.2 "호출자 변경".
- **Deps: task-02, task-03**(lib 시그니처 + kernel 해석기 존재).

## TDD steps

### Step 1 — drain 테스트: getSmtpConfig mock + sendMail config 인자 단언(FAIL 유도)

`tests/modules/leave/mail-drain.test.ts`:

(a) 기존 mock들 아래(line 12 `vi.mock("@/lib/integrations/mail", ...)` 다음)에 추가:
```ts
vi.mock("@/kernel/settings/reader", () => ({
  getSmtpConfig: vi.fn(async () => ({ host: "mail.x", port: 587, secure: false, user: "", from: "noreply@x.com" })),
}));
```

(b) "claim→발송→SENT finalize 성공" 테스트(line 30-37)에 config 인자 단언 추가 — 마지막 줄 뒤:
```ts
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["a@x.com"] }),
      expect.objectContaining({ host: "mail.x", from: "noreply@x.com" }),
    );
```

(c) REQUESTED 재확정 테스트(line 102)의 단언을 config 2번째 인자 포함으로 교체:
```ts
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ["now@x.com"] }), expect.anything()); // 스냅샷 stale@x.com 아님 — 현재 권한자
```

실행: `npm test -- tests/modules/leave/mail-drain.test.ts` → **FAIL**(sendMail이 아직 1-arg, getSmtpConfig 미호출).

### Step 2 — leave 드레인 배선

`src/modules/leave/services/mail.ts`:

(a) import 추가(`sendMail` import 줄 아래):
```ts
import { getSmtpConfig } from "@/kernel/settings/reader";
```

(b) `drainLeaveMailOutbox`에서 `const ids = await listDueDeliveryIds(new Date(), DRAIN_BATCH);` 바로 아래에 추가(배치당 1회 해석):
```ts
  const smtpConfig = await getSmtpConfig(); // 배치당 1회 해석(throw 없음, D10) — DB port/from 반영
```

(c) sendMail 호출(line 89)에 config 주입:
```ts
      ({ providerMessageId } = await sendMail({ to: recipients, subject: claimed.subject, html: claimed.bodyHtml }, smtpConfig));
```

실행: `npm test -- tests/modules/leave/mail-drain.test.ts` → **PASS**.

### Step 3 — workflows 테스트: getSmtpConfig mock + 인자 단언(FAIL 유도)

`tests/modules/workflows/mail-service.test.ts`:

(a) 기존 mock 아래(line 4 `vi.mock("@/lib/integrations/mail", ...)` 다음)에 추가:
```ts
vi.mock("@/kernel/settings/reader", () => ({
  getSmtpConfig: vi.fn(async () => ({ host: "mail.x", port: 587, secure: false, user: "", from: "noreply@x.com" })),
}));
```

(b) deliver "SENDING 선기록 → SMTP 성공 → SENT" 테스트(line 37-43)에서 `expect(send).toHaveBeenCalled();`(line 40)을 교체:
```ts
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "s" }),
      expect.objectContaining({ host: "mail.x" }),
    );
```

(c) retryDelivery "FAILED를 저장된 bodyHtml로 재발송" 테스트(line 79)의 단언을 config 2번째 인자 포함으로 교체:
```ts
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ["a@x"], subject: "s", html: "<p>저장본문</p>" }), expect.anything());
```

실행: `npm test -- tests/modules/workflows/mail-service.test.ts` → **FAIL**.

### Step 4 — workflows 배선

`src/modules/workflows/services/mail.ts`:

(a) import 추가(`sendMail` import 줄 아래):
```ts
import { getSmtpConfig } from "@/kernel/settings/reader";
```

(b) `deliver`에서 멱등 가드(`createSendingDelivery`) 이후, `let providerMessageId: string | null;` 바로 위에 추가:
```ts
  const smtpConfig = await getSmtpConfig(); // 멱등 가드 통과 후 해석(ConflictError 시 미발생)
```
그리고 sendMail 호출을 교체:
```ts
    ({ providerMessageId } = await sendMail(args.msg, smtpConfig));
```

(c) `retryDelivery`에서 첨부 유실 검사 이후, 재발송 try 직전(`let providerMessageId: string | null;` 위)에 추가:
```ts
  const smtpConfig = await getSmtpConfig();
```
그리고 재발송 sendMail 호출을 교체:
```ts
    ({ providerMessageId } = await sendMail({
      to: d.recipients,
      subject: d.subject,
      html: d.bodyHtml ?? "",
      attachments: d.attachmentPaths.map((p) => ({ filename: basename(p), path: p })),
    }, smtpConfig));
```

실행: `npm test -- tests/modules/workflows/mail-service.test.ts` → **PASS**.

## Acceptance Criteria

```bash
npm test -- tests/modules/leave/mail-drain.test.ts        # PASS
npm test -- tests/modules/workflows/mail-service.test.ts   # PASS
npm test -- tests/modules/leave tests/modules/workflows    # 회귀 없음
npm run typecheck                                          # 0 errors
npm run lint                                               # 0 errors — 모듈→@/kernel/settings/reader 허용 경로
```

## Cautions

- **Don't `getSmtpConfig`를 `@/kernel/settings`(index)나 `/service`에서 import하지 마라.** Reason: 모듈은 no-restricted-imports로 **`@/kernel/settings/reader`만** 허용. 다른 경로는 lint 실패.
- **Don't drain 루프 안에서 메시지마다 `getSmtpConfig`를 호출하지 마라.** Reason: 배치당 1회면 충분(설정은 배치 내 불변). 메시지마다 호출하면 불필요한 DB 읽기.
- **Don't 멱등 가드(`createSendingDelivery`) 전에 `getSmtpConfig`를 호출하지 마라(deliver).** Reason: ConflictError로 발송이 안 일어나는 경로에서 불필요한 해석. 가드 통과 후 해석.
- **Don't config 주입이 발송을 막을까 걱정해 try/catch로 감싸지 마라.** Reason: `getSmtpConfig`는 D10으로 이미 throw하지 않는다(env 폴백). 추가 방어 불필요.
