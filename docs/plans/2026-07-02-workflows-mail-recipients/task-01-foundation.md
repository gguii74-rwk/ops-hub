# Task 01 — 기반: 스키마·마이그레이션·수신자 타입·정책 파생

`MailContact` 테이블 + `MailDelivery.cc/bcc` 컬럼(additive 마이그레이션, D13), 수신자 타입·파서 모듈(`recipients.ts`), `SEND_STEP_TRANSITION` 파생 함수(D7)를 만든다. 이후 모든 태스크의 컴파일 기반.

## Files
- Modify: `prisma/schema.prisma` (`MailContact` 모델 추가 + `MailDelivery`에 `cc`/`bcc`)
- Create: `prisma/migrations/20260702000000_mail_recipients/migration.sql`
- Create: `src/modules/workflows/recipients.ts`
- Modify: `src/modules/workflows/policy.ts` (`sendStepsForKind`·`mailRecipientKinds` 추가)
- Test: `tests/modules/workflows/recipients.test.ts` (신규)
- Test: `tests/modules/workflows/policy.test.ts` (describe 추가)

## Prep
- 엔트리포인트 §SC-1(스키마), §SC-2(타입·파서), §SC-3(정책 파생).
- 참조: `prisma/schema.prisma` 444행 부근 `MailDelivery`(컬럼 추가 위치), `src/modules/workflows/policy.ts` 61행 `SEND_STEP_TRANSITION`.

## Deps
- 없음(첫 태스크).

## Cautions
- **Don't `WorkflowTask.recipients`/`WorkflowType.defaultRecipients` 컬럼을 drop·rename하지 마라.** Reason: D5 — 컬럼 보존(비가역 마이그레이션 회피). 해석 체인에서의 제거는 task-04.
- **Don't `recipients.ts`에 `import "server-only"`를 넣지 마라.** Reason: 클라 컴포넌트(발송 모달·관리 페이지)가 타입을 import한다 — 순수 모듈이어야 한다.
- **Don't 마이그레이션에 additive 외 SQL을 넣지 마라.** Reason: D13 = 표준 restart 배포 전제.
- **Don't `parseDefaultRecipients`가 flat 배열(`["a@x"]`)을 새 구조로 오독하게 하지 마라.** Reason: legacy 값은 preflight로 0을 증명하지만(§7), 파서 자체도 fail-closed(null)여야 한다.

## TDD Steps

### 1. recipients 파서 — 실패 테스트 먼저

`tests/modules/workflows/recipients.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import { parseDefaultRecipients, normalizeStoredEmails } from "@/modules/workflows/recipients";

describe("parseDefaultRecipients (D3 구조)", () => {
  it("null·flat 배열(legacy)·원시값 → null (새 구조로 오독하지 않음)", () => {
    expect(parseDefaultRecipients(null)).toBeNull();
    expect(parseDefaultRecipients(["a@x.com"])).toBeNull();
    expect(parseDefaultRecipients("a@x.com")).toBeNull();
    expect(parseDefaultRecipients(7)).toBeNull();
  });
  it("단계별 {to,cc,bcc} 채택, 누락 필드는 []", () => {
    expect(parseDefaultRecipients({ "1": { to: ["a@x.com"], cc: ["b@x.com"] } }))
      .toEqual({ "1": { to: ["a@x.com"], cc: ["b@x.com"], bcc: [] } });
  });
  it("비객체 step 값은 skip, 비문자 항목은 걸러낸다", () => {
    expect(parseDefaultRecipients({ "1": ["a@x.com"], "2": { to: ["a@x.com", 3] } }))
      .toEqual({ "2": { to: ["a@x.com"], cc: [], bcc: [] } });
  });
  it("빈 객체 → 빈 맵(널 아님)", () => {
    expect(parseDefaultRecipients({})).toEqual({});
  });
});

describe("normalizeStoredEmails (§3 세트 저장 정규화)", () => {
  it("trim·소문자·빈 제거·순서보존 dedup", () => {
    expect(normalizeStoredEmails([" A@X.com ", "a@x.com", "b@x.com", ""]))
      .toEqual(["a@x.com", "b@x.com"]);
  });
  it("빈 입력 → []", () => {
    expect(normalizeStoredEmails([])).toEqual([]);
  });
});
```

실행: `npm test -- tests/modules/workflows/recipients.test.ts` → **FAIL**(모듈 없음).

### 2. recipients.ts 구현

`src/modules/workflows/recipients.ts` 생성:

```ts
// 수신자 세트 공용 타입·파서(D3·D8). 순수 모듈 — 서버(repo·service)와 클라(모달·관리 페이지 타입)가 공유한다.
export interface RecipientFields { to: string[]; cc: string[]; bcc: string[] }
export type DefaultRecipientsMap = Record<string, RecipientFields>;

export interface RecipientEntry { email: string; name?: string }
export interface EffectiveRecipientFields { to: RecipientEntry[]; cc: RecipientEntry[]; bcc: RecipientEntry[] }
export type EffectiveRecipientsMap = Record<string, EffectiveRecipientFields>;

const toStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

// WorkflowType.defaultRecipients(Json) → 단계별 맵. flat legacy 배열·원시값은 null(fail-closed —
// preflight가 non-null legacy 0을 증명하지만, 파서도 오독 경로를 갖지 않는다).
export function parseDefaultRecipients(json: unknown): DefaultRecipientsMap | null {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const out: DefaultRecipientsMap = {};
  for (const [step, v] of Object.entries(json as Record<string, unknown>)) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) continue;
    const f = v as Record<string, unknown>;
    out[step] = { to: toStringArray(f.to), cc: toStringArray(f.cc), bcc: toStringArray(f.bcc) };
  }
  return out;
}

// 세트 저장 정규화(§3): trim → 빈 제거 → 소문자 → 순서보존 dedup. 주소록(email 소문자 저장, D2) 조인 매칭 일관.
export function normalizeStoredEmails(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const e = raw.trim().toLowerCase();
    if (e && !seen.has(e)) { seen.add(e); out.push(e); }
  }
  return out;
}
```

실행: `npm test -- tests/modules/workflows/recipients.test.ts` → **PASS**.

### 3. 정책 파생 — 실패 테스트 먼저

`tests/modules/workflows/policy.test.ts` 하단에 describe 추가(기존 import에 `sendStepsForKind, mailRecipientKinds` 추가):

```ts
describe("sendStepsForKind·mailRecipientKinds (D7 — SEND_STEP_TRANSITION 파생 단일 출처)", () => {
  it("BILLING의 발송 step은 ['1','2']", () => {
    expect(sendStepsForKind("BILLING")).toEqual(["1", "2"]);
  });
  it("발송 단계가 정의되지 않은 kind는 []", () => {
    expect(sendStepsForKind("WEEKLY_REPORT")).toEqual([]);
    expect(sendStepsForKind("WEEKLY_REPORT_CLIENT")).toEqual([]);
  });
  it("mailRecipientKinds는 현재 BILLING뿐 — 향후 kind에 step이 생기면 자동 확장", () => {
    expect(mailRecipientKinds()).toEqual(["BILLING"]);
  });
});
```

실행: `npm test -- tests/modules/workflows/policy.test.ts` → **FAIL**.

### 4. policy.ts 구현

`src/modules/workflows/policy.ts`의 `sendStepTransition` 함수 뒤에 추가:

```ts
// D7: 수신자 세트를 편집·노출할 kind×step = SEND_STEP_TRANSITION 파생 단일 출처.
// 발송이 정의되지 않은 kind의 세트는 소비처 없는 死설정 — 관리 화면·API가 이 파생만 허용한다.
export function sendStepsForKind(kind: WorkflowKind): string[] {
  return Object.keys(SEND_STEP_TRANSITION[kind] ?? {});
}

export function mailRecipientKinds(): WorkflowKind[] {
  return (Object.keys(SEND_STEP_TRANSITION) as WorkflowKind[]).filter((k) => sendStepsForKind(k).length > 0);
}
```

실행: `npm test -- tests/modules/workflows/policy.test.ts` → **PASS**.

### 5. 스키마 + 마이그레이션

`prisma/schema.prisma`의 `MailDelivery` 모델에 컬럼 2개 추가 — `recipients        Json` 줄 다음에:

```prisma
  cc                Json?
  bcc               Json?
```

`WorkflowTaskEvent` 모델 앞(= `MailDelivery` 모델 뒤)에 `MailContact` 추가:

```prisma
model MailContact {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  memo      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@schema("workflows")
}
```

`prisma/migrations/20260702000000_mail_recipients/migration.sql` 생성:

```sql
-- AlterTable (additive — D4·D13. 기존 행은 cc/bcc NULL → 소비자가 []로 해석)
ALTER TABLE "workflows"."MailDelivery" ADD COLUMN "cc" JSONB,
ADD COLUMN "bcc" JSONB;

-- CreateTable (D2 주소록)
CREATE TABLE "workflows"."MailContact" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailContact_email_key" ON "workflows"."MailContact"("email");
```

실행: `npm run prisma:validate` → 통과, `npm run prisma:generate` → Prisma Client 재생성(이후 태스크의 `prisma.mailContact`·`cc/bcc` 타입 전제).

### 6. 게이트 검증 + 커밋

```bash
npm run prisma:validate && npm run prisma:generate && npm run typecheck && npm run lint && npm test -- tests/modules/workflows/recipients.test.ts tests/modules/workflows/policy.test.ts
```

전부 green이면 커밋(다른 세션 작업과 섞이지 않게 위 Files만 명시적으로 stage — `.git/index.lock` 존재 확인 후).

## Acceptance Criteria
- `npm run prisma:validate` / `npm run prisma:generate` → 통과.
- `npm run typecheck` / `npm run lint` → 통과.
- `npm test -- tests/modules/workflows/recipients.test.ts tests/modules/workflows/policy.test.ts` → 통과.
- migration.sql은 additive 2건만(ALTER ADD COLUMN ×2 + CREATE TABLE + UNIQUE INDEX). DROP/UPDATE 문 없음.
- `git diff prisma/schema.prisma`에 기존 컬럼 변경 없음(추가만).
