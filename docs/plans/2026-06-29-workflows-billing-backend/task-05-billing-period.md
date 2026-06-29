# Task 05 — computeBillingPeriod 순수함수 (KST 전월 기준)

**Purpose:** 청구 instant에서 사업년도·회차·KST 캘린더 필드를 산출하는 순수함수를 신설한다. 전월 계산을 **Asia/Seoul 기준**으로 고정해 서버 TZ가 KST가 아닐 때의 오청구를 막는다(spec §7.3, J2).

## Files

- **Create:** `src/modules/workflows/billing/period.ts` — `computeBillingPeriod`·`toKstFields`·`getLastDayOfMonth`(§Shared Contracts SC-7)
- **Create (test):** `tests/modules/workflows/billing-period.test.ts`

## Prep

- 읽기: spec §7.3, entrypoint §Shared Contracts SC-7, day-sync `billing-hwpx-generator.ts` line 174~191(전월·회차 계산 원본, **로컬 TZ 의존 — 그대로 옮기면 안 됨**).
- KST 규약(재현): `src/modules/calendar/time.ts`의 `shiftToKst(d) = new Date(d.getTime() + 540*60_000)` 후 `getUTC*` 필드 읽기(UTC+9, DST 없음). **calendar 모듈을 import하지 않는다**(eslint boundaries — workflows는 calendar import 불가). 같은 규약을 self-contained로 재현한다.

## Deps

없음.

## TDD steps

### 1. 실패 테스트 작성 — `tests/modules/workflows/billing-period.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { computeBillingPeriod, toKstFields, getLastDayOfMonth } from "@/modules/workflows/billing/period";

describe("computeBillingPeriod (J2 KST 전월 기준)", () => {
  it("KST 3월 1일 자정(=2/28 15:00Z) → 전월=2월(UTC 서버 오산 방지)", () => {
    const r = computeBillingPeriod(new Date("2026-02-28T15:00:00Z"));
    expect(r.projectYear).toBe(2026);
    expect(r.round).toBe(2);
  });
  it("일반: KST 6월 15일 → 전월=5월", () => {
    const r = computeBillingPeriod(new Date("2026-06-15T03:00:00Z")); // KST 12:00
    expect(r.projectYear).toBe(2026);
    expect(r.round).toBe(5);
  });
  it("1월 경계: KST 1월 → 전월=전년 12월", () => {
    const r = computeBillingPeriod(new Date("2026-01-15T03:00:00Z"));
    expect(r.projectYear).toBe(2025);
    expect(r.round).toBe(12);
  });
  it("월 첫날 자정(KST) 경계: 6/1 00:00 KST = 5/31 15:00Z → 전월=5월", () => {
    const r = computeBillingPeriod(new Date("2026-05-31T15:00:00Z"));
    expect(r.projectYear).toBe(2026);
    expect(r.round).toBe(5);
  });
  it("billingDate는 입력 instant 그대로", () => {
    const d = new Date("2026-06-15T03:00:00Z");
    expect(computeBillingPeriod(d).billingDate.getTime()).toBe(d.getTime());
  });
});

describe("toKstFields / getLastDayOfMonth", () => {
  it("toKstFields: 2/28 15:00Z → KST 3/1", () => {
    expect(toKstFields(new Date("2026-02-28T15:00:00Z"))).toEqual({ year: 2026, month: 3, day: 1 });
  });
  it("toKstFields: 6/15 03:00Z → KST 6/15 12:00", () => {
    expect(toKstFields(new Date("2026-06-15T03:00:00Z"))).toEqual({ year: 2026, month: 6, day: 15 });
  });
  it("getLastDayOfMonth: 2026-02→28, 2024-02(윤년)→29, 2026-12→31", () => {
    expect(getLastDayOfMonth(2026, 2)).toBe(28);
    expect(getLastDayOfMonth(2024, 2)).toBe(29);
    expect(getLastDayOfMonth(2026, 12)).toBe(31);
  });
});
```

### 2. 실행 → FAIL

```bash
npm test -- tests/modules/workflows/billing-period.test.ts
```

### 3. 구현 — `src/modules/workflows/billing/period.ts`

```ts
// 순수함수(server-only 불필요 — DOM/Prisma 미접근). 단위 테스트 1층 대상.
// KST = UTC+9, DST 없음. calendar 모듈을 import하지 않고 같은 규약을 self-contained로 재현한다(boundaries).

export const KST_OFFSET_MIN = 540;
const KST_OFFSET_MS = KST_OFFSET_MIN * 60_000;

// instant → KST 벽시계 캘린더 필드(month/day 1-based). getUTC*만 쓰므로 서버 TZ와 무관.
export function toKstFields(d: Date): { year: number; month: number; day: number } {
  const s = new Date(d.getTime() + KST_OFFSET_MS);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate() };
}

// (year, month1=1-based)의 말일. 달력 산술이라 TZ 무관. Date.UTC(y, month1, 0) = month1월의 말일.
export function getLastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

// 청구 instant → 사업년도(전월의 연도, KST) + 회차(전월의 월, 1~12) + 청구일 instant.
// 전월 = KST 캘린더의 직전 달. 1월분 청구 = 12회차(전년). 1월 KST면 전월은 전년 12월.
export function computeBillingPeriod(scheduledAt: Date): { projectYear: number; round: number; billingDate: Date } {
  const { year, month } = toKstFields(scheduledAt); // month 1-based, KST
  const prevMonth = month === 1 ? 12 : month - 1;
  const projectYear = month === 1 ? year - 1 : year;
  return { projectYear, round: prevMonth, billingDate: scheduledAt };
}
```

### 4. 실행 → PASS

```bash
npm test -- tests/modules/workflows/billing-period.test.ts
```

### 5. commit

```bash
git add src/modules/workflows/billing/period.ts tests/modules/workflows/billing-period.test.ts
git commit -m "feat(workflows): computeBillingPeriod KST 전월 기준 순수함수(J2)"
```

## Acceptance Criteria

- `npm test -- tests/modules/workflows/billing-period.test.ts` 전건 PASS(월 경계·1월·자정 경계·윤년 말일).
- `npm run typecheck` / `npm run lint`(boundaries — period.ts는 어떤 모듈도 import하지 않는 순수함수) / `npm run build` 통과.
- TZ 독립성: 구현이 `getTime() + offset` 후 `getUTC*`만 쓰므로 결과가 서버 `process.env.TZ`와 무관(getLocal* 미사용). 이 속성이 J2 핵심.

## Cautions

- **Don't** `scheduledAt.getMonth()`/`getFullYear()`(로컬 메서드)를 쓰지 말 것. Reason: 운영 서버 TZ가 KST가 아니면 월 경계가 어긋나 회차/연도 오산 → 오청구(J2). 반드시 `toKstFields`(getUTC* 기반).
- **Don't** calendar 모듈의 `time.ts`를 import하지 말 것. Reason: eslint boundaries 위반(workflows는 calendar import 불가). 같은 규약을 self-contained로 재현.
- **Don't** `billingDate`를 KST로 시프트한 Date로 반환하지 말 것. Reason: 시프트된 Date를 다시 instant로 오해하면 9시간 어긋난다. instant는 그대로 두고, 캘린더 필드는 소비처가 `toKstFields`로 추출한다(task-06).
