# Task 02 — 메일 lib: `MailTransportConfig` + `sendMail(msg, config?)`

**Purpose**: 전송 config 타입을 메일 lib에 정의하고(경계 안전 D3·F1), `sendMail`/`buildTransport`가 주입된 config를 사용하도록 확장한다. config 미주입 시 현행 env-only 동작을 완전 보존한다. **비밀번호는 config에 흐르지 않는다**(env 직독, D2).

## Files

- Modify `src/lib/integrations/mail/index.ts`
- Modify `tests/lib/integrations/mail/send.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts SC-1(`MailTransportConfig`), SC-3(`sendMail` 시그니처).
- Deps: 없음(이 task가 SC-1 타입을 처음 정의).

## TDD steps

### Step 1 — config 주입/폴백 테스트 추가(FAIL 유도)

`tests/lib/integrations/mail/send.test.ts`에 describe 블록을 추가한다(기존 케이스는 그대로 둔다 — config 미주입 경로 회귀 보장):

```ts
import type { MailTransportConfig } from "@/lib/integrations/mail";

describe("sendMail — config 주입(MailTransportConfig)", () => {
  // 주입 config의 host/port/secure/user/from을 검증하려면 transport 빌드 인자를 봐야 하므로
  // nodemailer.createTransport를 가로채는 대신, fake transport에 from만 검증하고
  // transport 빌드는 별도 it에서 env 미주입 경로로 확인한다.
  it("config.from을 발신 주소로 사용(env SMTP_FROM 무시)", async () => {
    const prevFrom = process.env.SMTP_FROM;
    process.env.SMTP_FROM = "envfrom@x.com";
    try {
      const cfg: MailTransportConfig = { host: "mail.x", port: 2525, secure: false, user: "u", from: "dbfrom@x.com" };
      await sendMail({ to: ["a@x.com"], subject: "s", html: "<p>h</p>" }, cfg);
      expect(sent[0].from).toBe("dbfrom@x.com");
    } finally {
      if (prevFrom === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = prevFrom;
    }
  });

  it("config 미주입 시 from은 기존 env 폴백 체인 보존(SMTP_FROM)", async () => {
    const prevFrom = process.env.SMTP_FROM;
    process.env.SMTP_FROM = "envfrom@x.com";
    try {
      await sendMail({ to: ["a@x.com"], subject: "s", html: "<p>h</p>" });
      expect(sent[0].from).toBe("envfrom@x.com");
    } finally {
      if (prevFrom === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = prevFrom;
    }
  });
});
```

> transport 빌드 인자(host/port/secure/user)는 nodemailer를 직접 mock하지 않는 한 fake transport로는 보이지 않는다. config가 transport에 반영되는지는 **task-04의 호출자 배선 테스트**(sendMail이 config와 함께 호출됨)와 **수동 smoke**(port/from 저장 후 실제 발송)로 검증한다. 여기서는 lib 시그니처·from 해석·미주입 회귀만 단언한다.

실행: `npm test -- tests/lib/integrations/mail/send.test.ts` → **FAIL**(`sendMail`이 2번째 인자 미수용, `MailTransportConfig` export 없음).

### Step 2 — lib 구현: 타입 export + sendMail/buildTransport 확장

`src/lib/integrations/mail/index.ts`를 아래 전체 내용으로 교체한다:

```ts
import "server-only";
import nodemailer from "nodemailer";

export interface MailAttachment { filename: string; path: string; contentType?: string; }
export interface MailMessage { to: string[]; subject: string; html: string; attachments?: MailAttachment[]; }
export interface SendResult { providerMessageId: string | null; }
export interface MailTransport {
  sendMail(opts: {
    from: string; to: string; subject: string; html: string; attachments?: MailAttachment[];
  }): Promise<{ messageId?: string }>;
}

// 전송 config 타입(D3·F1): 메일 lib이 소유한다. kernel getSmtpConfig가 이 타입을 채택(kernel→lib 허용).
// 비밀번호는 여기 없다 — sendMail이 process.env.SMTP_PASSWORD에서 직접 읽는다(D2: secret은 config로 흐르지 않음).
export interface MailTransportConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
}

// 테스트 전용 transport 주입. 실제 SMTP 대신 fake를 꽂는다.
let testTransport: MailTransport | null = null;
export function setMailTransportForTests(t: MailTransport | null): void {
  testTransport = t;
}

const SIGNATURE_HTML =
  '<hr style="margin-top:24px"/><p style="color:#888;font-size:12px">본 메일은 ops-hub에서 자동 발송되었습니다.</p>';

// config 주입 시: host/port/secure/user를 config에서, pass는 env(D2). 미주입 시: 현행 env-only 동작 보존.
function buildTransport(config?: MailTransportConfig): MailTransport {
  const host = config ? config.host : process.env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST가 설정되지 않았습니다.");
  const port = config ? config.port : Number(process.env.SMTP_PORT ?? 587);
  const secure = config ? config.secure : process.env.SMTP_SECURE === "true";
  const user = config ? config.user : (process.env.SMTP_USER ?? "");
  return nodemailer.createTransport({
    host,
    port,
    secure,
    // user 비어있으면 무인증 릴레이(auth undefined) — 전송 auth 분기. pass는 항상 env(D2).
    auth: user ? { user, pass: process.env.SMTP_PASSWORD } : undefined,
  }) as unknown as MailTransport;
}

// trim + 대소문자 무시 중복 제거(첫 표기 보존).
function normalizeRecipients(to: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of to) {
    const t = raw.trim();
    const key = t.toLowerCase();
    if (t && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  if (out.length === 0) throw new Error("수신자가 없습니다.");
  return out.join(", ");
}

export async function sendMail(msg: MailMessage, config?: MailTransportConfig): Promise<SendResult> {
  const transport = testTransport ?? buildTransport(config);
  // config.from은 getSmtpConfig가 항상 비어있지 않게 보장. 미주입 시 기존 env 폴백 체인.
  const from = config?.from || process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@uracle.co.kr";
  const info = await transport.sendMail({
    from,
    to: normalizeRecipients(msg.to),
    subject: msg.subject,
    html: msg.html + SIGNATURE_HTML,
    attachments: msg.attachments,
  });
  return { providerMessageId: info.messageId ?? null };
}
```

실행: `npm test -- tests/lib/integrations/mail/send.test.ts` → **PASS**(기존 6개 + 신규 2개).

## Acceptance Criteria

```bash
npm test -- tests/lib/integrations/mail/send.test.ts   # PASS (기존 회귀 포함)
npm run typecheck                                       # 0 errors
npm run lint                                            # 0 errors — lib→lib만 import(MailTransportConfig는 자기 레이어)
```

## Cautions

- **Don't `MailTransportConfig`에 `password`/`pass` 필드를 추가하지 마라.** Reason: D2 — 비밀번호는 secret이라 config로 흐르면 audit/로그/직렬화 경로로 샐 수 있다. `buildTransport`가 `process.env.SMTP_PASSWORD`에서만 읽는다.
- **Don't 메일 lib에서 `@/kernel/*`를 import하지 마라.** Reason: eslint boundaries상 `lib`→`lib`만(F1). 타입은 lib이 소유하고 kernel이 채택한다.
- **Don't config 미주입 경로를 바꾸지 마라.** Reason: 기존 호출자/테스트(`setMailTransportForTests`, env-only)가 회귀하면 안 된다. config는 **선택적 인자**다.
- **Don't `from`을 `config?.from ?? <env>`(`??`)로 쓰지 마라.** Reason: 빈 문자열 config.from이 들어오면 발신주소가 ""가 된다. `||`로 빈값까지 폴백(getSmtpConfig가 비어있지 않게 보장하지만 방어).
