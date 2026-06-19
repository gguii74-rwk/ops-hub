# Task 05 — 메일 전송 lib (Nodemailer) + env

`lib/integrations/mail`에 순수 SMTP 전송 책임만 두는 `sendMail`을 만든다(이력 기록 없음 — 그건 Task 06 service). 수신자 정규화·HTML 서명·테스트 transport 주입을 포함한다.

## Files

- Modify: `src/lib/env/schema.ts` (SMTP env 추가, optional)
- Create: `src/lib/integrations/mail/index.ts`
- Create (test): `tests/lib/integrations/mail/send.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts **SC-7**(메일 lib 타입·시그니처·env).
- Spec §6.1(`lib/integrations/mail`). `nodemailer`·`@types/nodemailer`는 이미 설치됨(package.json).
- 기존 lib 패턴: `src/lib/integrations/google/calendar.ts`(process.env 직접 읽기, `server-only`).
- boundaries: lib는 lib만 import. module 타입 import 금지.

## Deps

없음.

## Step 1 — 실패 테스트

생성: `tests/lib/integrations/mail/send.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendMail, setMailTransportForTests, type MailTransport } from "@/lib/integrations/mail";

let sent: any[] = [];
const fake: MailTransport = {
  async sendMail(opts) {
    sent.push(opts);
    return { messageId: "msg-123" };
  },
};

beforeEach(() => {
  sent = [];
  setMailTransportForTests(fake);
});
afterEach(() => setMailTransportForTests(null));

describe("sendMail", () => {
  it("주입된 transport로 발송하고 providerMessageId를 messageId에서 가져온다", async () => {
    const out = await sendMail({ to: ["a@x.com"], subject: "제목", html: "<p>본문</p>" });
    expect(out).toEqual({ providerMessageId: "msg-123" });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("제목");
    expect(sent[0].to).toBe("a@x.com");
  });

  it("수신자를 정규화(trim·중복 제거)해 콤마로 결합", async () => {
    await sendMail({ to: [" a@x.com ", "A@x.com", "b@x.com"], subject: "s", html: "<p>h</p>" });
    expect(sent[0].to).toBe("a@x.com, b@x.com");
  });

  it("HTML 서명을 본문 뒤에 덧붙인다", async () => {
    await sendMail({ to: ["a@x.com"], subject: "s", html: "<p>본문</p>" });
    expect(sent[0].html.startsWith("<p>본문</p>")).toBe(true);
    expect(sent[0].html).toContain("자동 발송");
  });

  it("messageId가 없으면 providerMessageId=null", async () => {
    setMailTransportForTests({ async sendMail() { return {}; } });
    expect(await sendMail({ to: ["a@x.com"], subject: "s", html: "<p>h</p>" })).toEqual({ providerMessageId: null });
  });

  it("수신자가 비면 에러", async () => {
    await expect(sendMail({ to: ["  "], subject: "s", html: "<p>h</p>" })).rejects.toThrow();
  });

  it("transport 미주입 + SMTP_HOST 미설정 → 에러(조용한 성공 금지)", async () => {
    setMailTransportForTests(null);
    const prev = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      await expect(sendMail({ to: ["a@x.com"], subject: "s", html: "<p>h</p>" })).rejects.toThrow(/SMTP_HOST/);
    } finally {
      if (prev !== undefined) process.env.SMTP_HOST = prev;
    }
  });
});
```

## Step 2 — FAIL 확인

```bash
npm test -- tests/lib/integrations/mail/send.test.ts
```

## Step 3 — env 추가

`src/lib/env/schema.ts`의 `z.object({...})` 안, 기존 `SMTP_PASSWORD: z.string().optional(),` 줄을 다음 블록으로 교체:

```ts
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().optional(),
    SMTP_SECURE: z.string().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().optional(),
```

## Step 4 — mail lib 구현

생성: `src/lib/integrations/mail/index.ts`

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

// 테스트 전용 transport 주입. 실제 SMTP 대신 fake를 꽂는다.
let testTransport: MailTransport | null = null;
export function setMailTransportForTests(t: MailTransport | null): void {
  testTransport = t;
}

const SIGNATURE_HTML =
  '<hr style="margin-top:24px"/><p style="color:#888;font-size:12px">본 메일은 ops-hub에서 자동 발송되었습니다.</p>';

function buildTransport(): MailTransport {
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST가 설정되지 않았습니다.");
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
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

export async function sendMail(msg: MailMessage): Promise<SendResult> {
  const transport = testTransport ?? buildTransport();
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@uracle.co.kr";
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

## Step 5 — PASS

```bash
npm test -- tests/lib/integrations/mail/send.test.ts
```

## Step 6 — commit

```bash
git add src/lib/env/schema.ts src/lib/integrations/mail/index.ts tests/lib/integrations/mail/send.test.ts
git commit -m "feat(mail): Nodemailer send lib (normalize recipients, signature, test transport)"
```

## Acceptance Criteria

```bash
npm run typecheck   # 통과
npm run lint        # 통과(lib는 lib/외부만 import)
npm test -- tests/lib/integrations/mail/send.test.ts   # PASS
npm test            # 전체 통과(env.test.ts 회귀 포함 — SMTP는 모두 optional)
```

## Cautions

- **이 lib에 `MailDelivery` 기록·재시도·멱등을 넣지 말 것.** 순수 전송만. 이력·멱등·SENDING은 Task 06 service 책임(spec §6.1 "이력 기록 없음").
- **module 타입을 import하지 말 것**(boundaries: lib→lib만). `MailMessage` 등은 lib-local로 선언한다.
- env에 SMTP 변수를 **required로 만들지 말 것** — 미설정 dev에서 부팅이 깨진다. 미설정은 전송 시점(`buildTransport`)에 에러로 드러낸다.
- 발송 실패를 삼키지 말 것(reject 그대로 전파) — service가 FAILED로 기록한다.
