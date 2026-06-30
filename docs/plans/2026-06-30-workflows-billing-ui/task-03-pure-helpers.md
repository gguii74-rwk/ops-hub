# Task 03 — 순수 헬퍼: 메일 템플릿 + 회차일 변환 (D3·D4·D11·F6)

발송 모달·설정 화면이 쓰는 순수 함수 2종을 만든다. 둘 다 백엔드 KST 순수 함수(`period.ts`)를 재사용해 골든 parity를 보장한다(D4).

## Files

- Create: `src/app/(app)/workflows/mail-templates.ts` (buildSubject/buildBody/plainToHtml)
- Create: `src/app/(app)/workflows/billing/settings/round-date.ts` (date↔UTC ISO 변환)
- Create (test): `tests/app/workflows/mail-templates.test.ts`
- Create (test): `tests/app/workflows/round-date.test.ts`

## Prep

- 엔트리포인트 §SC-7(KST·날짜 계약)·§SC-8(메일 템플릿) 숙지.
- 재사용: `@/modules/workflows/billing/period`의 `computeBillingPeriod(scheduledAt) → { projectYear, round, billingDate }`·`toKstFields(d) → { year, month, day }`(KST, 순수, server-only 아님). app→module import는 boundaries 허용.
- 텍스트는 day-sync `src/app/tasks/[taskId]/send/page.tsx` 포팅(`buildBillingSubject/Body`·`buildHqRequestSubject/Body`)에 `projectName` 치환 + KST 적용.

## Deps

없음.

## TDD steps

### Step 1 — mail-templates 테스트 작성 (RED)

`tests/app/workflows/mail-templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSubject, buildBody, plainToHtml } from "@/app/(app)/workflows/mail-templates";

const ctx = (iso: string, projectName = "테스트사업") => ({ scheduledAt: new Date(iso), projectName });

describe("buildSubject", () => {
  it("step1: 전월(round)·projectYear·projectName 치환(KST)", () => {
    // 2026-02-10 KST(=2026-02-09T15:00Z): 전월=1월, projectYear=2026
    expect(buildSubject(1, ctx("2026-02-09T15:00:00.000Z"))).toBe("2026년 테스트사업 1월 대금 청구의 건");
  });
  it("step2: 서류 요청의 건", () => {
    expect(buildSubject(2, ctx("2026-02-09T15:00:00.000Z"))).toBe("2026년 테스트사업 1월 대금 청구 서류 요청의 건");
  });
  it("KST 월 경계: 3/1 00:00 KST면 전월=2월(서버 TZ 무관, D4)", () => {
    // 2026-03-01T00:00 KST = 2026-02-28T15:00Z. 로컬 UTC 메서드면 2월 28일로 읽어 회차 오산.
    expect(buildSubject(1, ctx("2026-02-28T15:00:00.000Z"))).toBe("2026년 테스트사업 2월 대금 청구의 건");
  });
  it("1월 경계: 1월분 청구는 전년 12월·전년 projectYear", () => {
    expect(buildSubject(1, ctx("2026-01-15T00:00:00.000Z"))).toBe("2025년 테스트사업 12월 대금 청구의 건");
  });
});

describe("buildBody", () => {
  it("step1: 공문 발송일(billingM/billingD)·KST 요일·전월 청구 문구", () => {
    const body = buildBody(1, ctx("2026-02-09T15:00:00.000Z")); // KST 2026-02-10(화)
    expect(body).toContain("2026년 테스트사업 1월 대금 청구 관련 서류보내드리니");
    expect(body).toContain("공문 발송일은 2월 10일로 작성하였습니다.");
    expect(body).toContain("2월 10일(화)에 원본 서류 전달 드리겠습니다.");
  });
  it("step2: projectName + 완납증명서/4대보험 문구", () => {
    const body = buildBody(2, ctx("2026-02-09T15:00:00.000Z"));
    expect(body).toContain("테스트사업 대금 청구 관련하여 서류 요청 드립니다.");
    expect(body).toContain("2월 10일(화) 발행한 국세/지방세 완납증명서, 4대보험 완납증명서 스캔본(PDF)");
  });
});

describe("plainToHtml", () => {
  it("줄은 <p>, 빈 줄은 <br>", () => {
    expect(plainToHtml("a\n\nb")).toBe("<p>a</p>\n<br>\n<p>b</p>");
  });
  it("HTML 특수문자·태그를 escape(외부 발송 본문 주입 차단, F-A1)", () => {
    expect(plainToHtml("<img src=x onerror=alert(1)>")).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
    expect(plainToHtml("A&B <b>회사</b>")).toBe("<p>A&amp;B &lt;b&gt;회사&lt;/b&gt;</p>");
  });
});
```

Run: `npm test -- tests/app/workflows/mail-templates.test.ts` → **FAIL**(파일 없음).

### Step 2 — mail-templates.ts 구현

`src/app/(app)/workflows/mail-templates.ts`:

```ts
import { computeBillingPeriod, toKstFields } from "@/modules/workflows/billing/period";

// 전월·회차·연도는 백엔드 순수 함수 재사용(골든 parity — D4). 요일만 KST 보조 계산.
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const KST_OFFSET_MS = 540 * 60_000;
function kstWeekday(d: Date): string {
  return WEEKDAYS[new Date(d.getTime() + KST_OFFSET_MS).getUTCDay()];
}

export interface BillingMailContext {
  scheduledAt: Date;
  projectName: string;
}

export function buildSubject(step: 1 | 2, ctx: BillingMailContext): string {
  const { projectYear, round } = computeBillingPeriod(ctx.scheduledAt);
  return step === 1
    ? `${projectYear}년 ${ctx.projectName} ${round}월 대금 청구의 건`
    : `${projectYear}년 ${ctx.projectName} ${round}월 대금 청구 서류 요청의 건`;
}

export function buildBody(step: 1 | 2, ctx: BillingMailContext): string {
  const { projectYear, round } = computeBillingPeriod(ctx.scheduledAt);
  const { month: billingM, day: billingD } = toKstFields(ctx.scheduledAt);
  const weekday = kstWeekday(ctx.scheduledAt);
  if (step === 1) {
    return [
      "안녕하세요, 유라클 노원국 입니다.",
      "",
      `${projectYear}년 ${ctx.projectName} ${round}월 대금 청구 관련 서류보내드리니`,
      "확인 및 검토 부탁드리겠습니다.",
      `공문 발송일은 ${billingM}월 ${billingD}일로 작성하였습니다.`,
      `검토가 끝나면 직인 날인 후 ${billingM}월 ${billingD}일(${weekday})에 원본 서류 전달 드리겠습니다.`,
      "",
      "감사합니다.",
    ].join("\n");
  }
  return [
    "안녕하세요, 세종개발본부 노원국 입니다.",
    "",
    `${ctx.projectName} 대금 청구 관련하여 서류 요청 드립니다.`,
    `${billingM}월 ${billingD}일(${weekday}) 발행한 국세/지방세 완납증명서, 4대보험 완납증명서 스캔본(PDF)을 메일로 회신 부탁 드리겠습니다.`,
    "",
    "감사합니다.",
  ].join("\n");
}

// HTML escape — 본문·projectName이 escape 없이 msg.html로 외부 발송되면 임의 HTML 주입(F-A1).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// plain text → HTML(줄바꿈 보존, 선두 공백 &nbsp;). deliver가 msg.html로 사용(SC-5). day-sync 변환 포팅 + escape.
export function plainToHtml(plain: string): string {
  return plain
    .split("\n")
    .map((line) => {
      if (!line.trim()) return "<br>";
      // escape 먼저(입력의 &<>"' 무력화) → 선두 공백을 &nbsp;로(이때 삽입되는 &는 재escape 안 함).
      const preserved = escapeHtml(line).replace(/^ +/, (spaces) => "&nbsp;".repeat(spaces.length));
      return `<p>${preserved}</p>`;
    })
    .join("\n");
}
```

Run: `npm test -- tests/app/workflows/mail-templates.test.ts` → **PASS**.

### Step 3 — round-date 테스트 작성 (RED)

`tests/app/workflows/round-date.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dateInputToSubmitDateIso, submitDateIsoToDateInput } from "@/app/(app)/workflows/billing/settings/round-date";

describe("dateInputToSubmitDateIso (D11)", () => {
  it("KST 자정 → UTC 전일 15:00Z", () => {
    expect(dateInputToSubmitDateIso("2026-02-10")).toBe("2026-02-09T15:00:00.000Z");
  });
  it("연 경계: 2026-01-01 → 2025-12-31T15:00Z", () => {
    expect(dateInputToSubmitDateIso("2026-01-01")).toBe("2025-12-31T15:00:00.000Z");
  });
});

describe("submitDateIsoToDateInput", () => {
  it("UTC ISO → KST date(YYYY-MM-DD)", () => {
    expect(submitDateIsoToDateInput("2026-02-09T15:00:00.000Z")).toBe("2026-02-10");
  });
  it("round-trip 보존", () => {
    expect(submitDateIsoToDateInput(dateInputToSubmitDateIso("2026-12-31"))).toBe("2026-12-31");
  });
});
```

Run: `npm test -- tests/app/workflows/round-date.test.ts` → **FAIL**(파일 없음).

### Step 4 — round-date.ts 구현

`src/app/(app)/workflows/billing/settings/round-date.ts`:

```ts
import { toKstFields } from "@/modules/workflows/billing/period";

// date input "YYYY-MM-DD" → KST 자정 기준 UTC ISO(...Z). 백엔드 billingRoundDateUpdateSchema(z.string().datetime())가 UTC Z를 요구(D11).
export function dateInputToSubmitDateIso(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+09:00`).toISOString();
}

// 저장된 UTC ISO → date input "YYYY-MM-DD"(KST 환원, 표시용).
export function submitDateIsoToDateInput(iso: string): string {
  const s = toKstFields(new Date(iso));
  return `${s.year}-${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}`;
}
```

Run: `npm test -- tests/app/workflows/round-date.test.ts` → **PASS**.

## Acceptance Criteria

- `npm test -- tests/app/workflows/mail-templates.test.ts tests/app/workflows/round-date.test.ts` → PASS.
- `npm run typecheck` → 0 errors.
- `npm run lint` → boundaries 위반 없음(app→module period import 허용).
- 전체 `npm test` → 회귀 0.

## Cautions

- **Don't** 로컬 `Date.getMonth()/getFullYear()`로 전월·회차를 계산하지 말 것(D4). 운영 서버 TZ가 KST가 아니면 월 경계가 어긋나 오청구된다. `computeBillingPeriod`/`toKstFields`만 사용.
- **Don't** date-only `YYYY-MM-DD`를 회차 PUT에 직송하지 말 것(D11) — 백엔드 `z.string().datetime()`가 400을 낸다. 반드시 `dateInputToSubmitDateIso`로 변환.
- **Don't** mail body를 HTML로 직접 만들지 말 것 — plain text로 만들고(편집·테스트 용이) 전송 직전 `plainToHtml`로 변환한다(send-modal에서).
- **Don't** `plainToHtml`에서 escape를 빼지 말 것(F-A1) — 본문·projectName은 사용자 편집/설정값이고 백엔드가 `msg.html`로 외부 발송한다. escape 없으면 `<`,`>`,`&` 포함 사업명이 메일에서 깨지고(정합성) 임의 HTML/링크 주입 경로가 열린다(보안). escape를 선두 공백 `&nbsp;` 치환보다 **먼저** 적용한다.
- 텍스트 문구는 day-sync 원문 + projectName/KST 치환이다. **최종 문구·서명은 3층 수동 게이트(한컴/메일 눈 대조)로 확정**한다(spec §8) — 본 태스크는 위 표준 문자열을 구현 대상으로 고정.
