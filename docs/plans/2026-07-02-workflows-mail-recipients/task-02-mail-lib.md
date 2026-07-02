# Task 02 — mail lib: normalizeEnvelope(D10) + cc/bcc 전달

메일 lib이 정규화 규칙(D10)을 **단일 소유·export**하고, `MailMessage`/`MailTransport`가 cc/bcc를 지원하게 한다. 기존 호출자(leave 알림 등, cc/bcc 미지정)는 동작 불변.

## Files
- Modify: `src/lib/integrations/mail/index.ts`
- Test: `tests/lib/integrations/mail/send.test.ts` (describe 2개 추가)

## Prep
- 엔트리포인트 §SC-4(envelope 계약).
- 참조: `src/lib/integrations/mail/index.ts` 현재 76행(사설 `normalizeRecipients`를 대체), `tests/lib/integrations/mail/send.test.ts`(fake transport 관례 — `sent` 배열에 opts 축적).

## Deps
- 없음(task-01과 병렬 가능).

## Cautions
- **Don't 기존 to 정규화 동작(trim·대소문자 무시 dedup·첫 표기 보존·콤마 결합)을 바꾸지 마라.** Reason: 기존 테스트("a@x.com, b@x.com")·leave 호출자 회귀.
- **Don't cc/bcc가 비었을 때 transport opts에 빈 문자열을 넣지 마라.** Reason: 헤더 생략이 계약(§4.1) — `"cc" in opts === false`.
- **Don't normalizeEnvelope에서 to 비면 throw하지 마라.** Reason: throw는 소비자 몫(sendMail은 기존대로 throw, deliver는 ConflictError). 파서는 순수·멱등.
- **Don't SIGNATURE_HTML·buildTransport·MailTransportConfig(D2 secret 경계)를 건드리지 마라.** Reason: 이 태스크 범위 밖(surgical).

## TDD Steps

### 1. 실패 테스트 먼저

`tests/lib/integrations/mail/send.test.ts`의 import를 갱신:

```ts
import { sendMail, normalizeEnvelope, setMailTransportForTests, type MailTransport, type MailTransportConfig } from "@/lib/integrations/mail";
```

파일 하단에 describe 2개 추가:

```ts
describe("normalizeEnvelope (D10 — lib 단일 소유)", () => {
  it("필드별 trim·빈 제거·대소문자 무시 dedup(첫 표기 보존)", () => {
    expect(normalizeEnvelope({ to: [" A@x.com ", "a@X.com", "b@x.com", "" ] }))
      .toEqual({ to: ["A@x.com", "b@x.com"], cc: [], bcc: [] });
  });
  it("교차 제외: cc−to, bcc−(to∪cc)", () => {
    expect(normalizeEnvelope({ to: ["a@x.com"], cc: ["A@x.com", "c@x.com"], bcc: ["c@X.com", "d@x.com"] }))
      .toEqual({ to: ["a@x.com"], cc: ["c@x.com"], bcc: ["d@x.com"] });
  });
  it("멱등: 정규화 결과에 재적용해도 동일(retry가 저장 envelope를 재발송해도 무해)", () => {
    const once = normalizeEnvelope({ to: ["a@x.com", "A@x.com"], cc: ["b@x.com"], bcc: ["c@x.com", "b@x.com"] });
    expect(normalizeEnvelope(once)).toEqual(once);
  });
  it("to 빈 결과 허용(throw는 소비자 몫), cc/bcc 미지정 → []", () => {
    expect(normalizeEnvelope({ to: ["  "] })).toEqual({ to: [], cc: [], bcc: [] });
  });
});

describe("sendMail cc/bcc (D10·§4.1)", () => {
  it("cc/bcc를 콤마 결합해 transport에 전달", async () => {
    await sendMail({ to: ["a@x.com"], cc: ["b@x.com", "c@x.com"], bcc: ["d@x.com"], subject: "s", html: "<p>h</p>" });
    expect(sent[0].cc).toBe("b@x.com, c@x.com");
    expect(sent[0].bcc).toBe("d@x.com");
  });
  it("cc/bcc 미지정이면 헤더 자체를 생략(기존 호출 형태 회귀 — leave 등)", async () => {
    await sendMail({ to: ["a@x.com"], subject: "s", html: "<p>h</p>" });
    expect("cc" in sent[0]).toBe(false);
    expect("bcc" in sent[0]).toBe(false);
  });
  it("to와 중복된 cc는 전송 전 제거(방어 정규화 — 직접 호출자 대비)", async () => {
    await sendMail({ to: ["a@x.com"], cc: ["A@x.com"], subject: "s", html: "h" });
    expect("cc" in sent[0]).toBe(false);
  });
});
```

실행: `npm test -- tests/lib/integrations/mail/send.test.ts` → **FAIL**(`normalizeEnvelope` 없음).

### 2. 구현 — `src/lib/integrations/mail/index.ts`

인터페이스 갱신(4~11행 대체):

```ts
export interface MailAttachment { filename: string; path: string; contentType?: string; }
export interface MailMessage { to: string[]; cc?: string[]; bcc?: string[]; subject: string; html: string; attachments?: MailAttachment[]; }
export interface SendResult { providerMessageId: string | null; }
export interface MailTransport {
  sendMail(opts: {
    from: string; to: string; cc?: string; bcc?: string; subject: string; html: string; attachments?: MailAttachment[];
  }): Promise<{ messageId?: string }>;
}
```

사설 `normalizeRecipients` 함수(48~62행)를 **제거**하고 그 자리에 export 정규화(D10)를 넣는다:

```ts
export interface MailEnvelope { to: string[]; cc: string[]; bcc: string[] }

// D10 정규화(단일 소유·멱등): 필드별 trim·빈 제거·대소문자 무시 dedup(첫 표기 보존) + 교차 제외
// cc−to, bcc−(to∪cc). deliver가 MailDelivery 기록 전에 적용해 "기록 = 실제 전송 envelope"를 보장하고,
// sendMail도 방어적으로 재적용한다(직접 호출자 대비 — 멱등이라 무해). to 빈 결과 허용(throw는 소비자 몫).
export function normalizeEnvelope(input: { to: string[]; cc?: string[]; bcc?: string[] }): MailEnvelope {
  const dedup = (list: string[], exclude: Set<string>): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of list) {
      const t = raw.trim();
      const key = t.toLowerCase();
      if (t && !seen.has(key) && !exclude.has(key)) { seen.add(key); out.push(t); }
    }
    return out;
  };
  const to = dedup(input.to, new Set());
  const toKeys = new Set(to.map((e) => e.toLowerCase()));
  const cc = dedup(input.cc ?? [], toKeys);
  const ccKeys = new Set([...toKeys, ...cc.map((e) => e.toLowerCase())]);
  const bcc = dedup(input.bcc ?? [], ccKeys);
  return { to, cc, bcc };
}
```

`sendMail` 함수를 대체:

```ts
export async function sendMail(msg: MailMessage, config?: MailTransportConfig): Promise<SendResult> {
  const transport = testTransport ?? buildTransport(config);
  // config.from은 getSmtpConfig가 항상 비어있지 않게 보장. 미주입 시 기존 env 폴백 체인.
  const from = config?.from || process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@uracle.co.kr";
  const env = normalizeEnvelope(msg);
  if (env.to.length === 0) throw new Error("수신자가 없습니다.");
  const info = await transport.sendMail({
    from,
    to: env.to.join(", "),
    ...(env.cc.length > 0 ? { cc: env.cc.join(", ") } : {}),
    ...(env.bcc.length > 0 ? { bcc: env.bcc.join(", ") } : {}),
    subject: msg.subject,
    html: msg.html + SIGNATURE_HTML,
    attachments: msg.attachments,
  });
  return { providerMessageId: info.messageId ?? null };
}
```

실행: `npm test -- tests/lib/integrations/mail/send.test.ts` → **PASS**(기존 케이스 포함 — "수신자를 정규화해 콤마로 결합"·"수신자가 비면 에러" 그대로 통과해야 함).

### 3. 게이트 검증 + 커밋

```bash
npm run typecheck && npm run lint && npm test -- tests/lib/integrations/mail
```

leave 회귀 확인(호출부 무변경이지만 타입 확장 영향 검증):

```bash
npm test -- tests/modules/leave
```

전부 green이면 위 Files만 stage해 커밋.

## Acceptance Criteria
- `npm run typecheck` / `npm run lint` → 통과.
- `npm test -- tests/lib/integrations/mail` → 통과(기존 8케이스 + 신규 7케이스).
- `npm test -- tests/modules/leave` → 통과(기존 호출자 무변경 회귀).
- `normalizeEnvelope`가 export되고 사설 `normalizeRecipients`는 제거됨(중복 정규화 경로 없음).
