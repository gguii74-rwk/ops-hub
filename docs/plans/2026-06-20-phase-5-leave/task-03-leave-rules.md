# Task 03 — leave rules·types·errors (순수 도메인)

**Purpose:** POC의 일수 계산·날짜 검증 규칙을 순수 함수로 포팅(공휴일 제외 추가). 공유 DTO 타입·도메인 에러도 함께 정의. DB·외부·시각 의존 없음(전부 인자 주입 → 결정적 테스트).

## Files
- Create: `src/modules/leave/types.ts`
- Create: `src/modules/leave/errors.ts`
- Create: `src/modules/leave/rules.ts`
- Create: `tests/modules/leave/rules.test.ts`

## Prep
- spec §5 / entrypoint §SC-3, §SC-4, §SC-5.
- POC 규칙 출처: `D:/workspace/annual-leave/backend/src/utils/date.ts`.
- 모든 날짜 로직은 **UTC 기준**(TZ 결정성). `"YYYY-MM-DD"`는 UTC 자정으로 파싱.

## Deps
없음(03·07 병렬 가능).

## Steps

### 1. types.ts (DTO)
`src/modules/leave/types.ts` — entrypoint §SC-3 그대로:

```ts
import type { LeaveType, LeaveSubType } from "@prisma/client";

export interface CreateLeaveInput {
  leaveType: LeaveType;
  leaveSubType?: LeaveSubType | null;
  quarterStartTime?: string | null;
  startDate: string;
  endDate: string;
  reason?: string | null;
}

export interface AllocationSummary {
  year: number;
  allocatedDays: number;
  carriedOverDays: number;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
  carriedOverExpiryDate: Date | null;
}

export interface AdjustAllocationInput {
  userId: string;
  year: number;
  changeDays: number;
  changeType: "ADD" | "DEDUCT";
  reason: string;
  reasonDetail?: string | null;
}

export interface LeaveCtx {
  userId: string;
  isOwner: boolean;
  permissionKeys: Set<string>;
}
```

### 2. errors.ts
`src/modules/leave/errors.ts` — entrypoint §SC-4 그대로:

```ts
export class LeaveValidationError extends Error {
  constructor(message: string) { super(message); this.name = "LeaveValidationError"; }
}
export class LeaveConflictError extends Error {
  constructor(message: string) { super(message); this.name = "LeaveConflictError"; }
}
```

### 3. 실패 테스트
`tests/modules/leave/rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  toDateKey, parseLeaveDate, calculateLeaveDays, validateDates,
  validateDatesForAdmin, validateLeaveTypeDates, calculateCarriedOverExpiry, kstToday,
} from "@/modules/leave/rules";
import { LeaveValidationError } from "@/modules/leave/errors";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("calculateLeaveDays", () => {
  it("ANNUAL: 평일 5일(월~금)", () => {
    expect(calculateLeaveDays("ANNUAL", d("2026-08-10"), d("2026-08-14"), new Set())).toBe(5); // 월~금
  });
  it("ANNUAL: 주말 제외", () => {
    expect(calculateLeaveDays("ANNUAL", d("2026-08-14"), d("2026-08-17"), new Set())).toBe(2); // 금,월 (토일 제외)
  });
  it("ANNUAL: 공휴일 제외", () => {
    const holidays = new Set(["2026-08-17"]); // 가상 공휴일(월)
    expect(calculateLeaveDays("ANNUAL", d("2026-08-14"), d("2026-08-17"), holidays)).toBe(1); // 금만
  });
  it("HALF=0.5, QUARTER=0.25", () => {
    expect(calculateLeaveDays("HALF", d("2026-08-14"), d("2026-08-14"), new Set())).toBe(0.5);
    expect(calculateLeaveDays("QUARTER", d("2026-08-14"), d("2026-08-14"), new Set())).toBe(0.25);
  });
});

describe("validateDates (직원)", () => {
  const today = d("2026-08-14");
  it("과거 거부", () => {
    expect(() => validateDates(d("2026-08-13"), d("2026-08-13"), today)).toThrow(LeaveValidationError);
  });
  it("start>end 거부", () => {
    expect(() => validateDates(d("2026-08-20"), d("2026-08-19"), today)).toThrow(LeaveValidationError);
  });
  it("당일·미래 허용", () => {
    expect(() => validateDates(d("2026-08-14"), d("2026-08-15"), today)).not.toThrow();
  });
});

describe("validateDatesForAdmin", () => {
  it("과거 허용, start>end만 거부", () => {
    expect(() => validateDatesForAdmin(d("2020-01-01"), d("2020-01-02"))).not.toThrow();
    expect(() => validateDatesForAdmin(d("2026-08-20"), d("2026-08-19"))).toThrow(LeaveValidationError);
  });
});

describe("validateLeaveTypeDates", () => {
  it("HALF 여러 날 거부, 단일일 허용", () => {
    expect(() => validateLeaveTypeDates("HALF", d("2026-08-14"), d("2026-08-15"))).toThrow(LeaveValidationError);
    expect(() => validateLeaveTypeDates("HALF", d("2026-08-14"), d("2026-08-14"))).not.toThrow();
    expect(() => validateLeaveTypeDates("ANNUAL", d("2026-08-14"), d("2026-08-15"))).not.toThrow();
  });
});

describe("기타", () => {
  it("calculateCarriedOverExpiry → 익년 6/30(UTC)", () => {
    expect(toDateKey(calculateCarriedOverExpiry(2026))).toBe("2027-06-30");
  });
  it("parseLeaveDate 형식 위반 throw", () => {
    expect(() => parseLeaveDate("2026/08/14")).toThrow(LeaveValidationError);
    expect(toDateKey(parseLeaveDate("2026-08-14"))).toBe("2026-08-14");
  });
  it("kstToday: KST 자정 경계", () => {
    // 2026-08-14 23:00 UTC = 2026-08-15 08:00 KST
    expect(toDateKey(kstToday(new Date("2026-08-14T23:00:00.000Z")))).toBe("2026-08-15");
  });
});
```

```
npm test -- tests/modules/leave/rules   # expect FAIL (rules 없음)
```

### 4. 최소 구현
`src/modules/leave/rules.ts`:

```ts
import type { LeaveType } from "@prisma/client";
import { LeaveValidationError } from "./errors";

/** UTC ISO 날짜 키 "YYYY-MM-DD". */
export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → UTC 자정 Date. 형식·유효성 위반 시 LeaveValidationError. */
export function parseLeaveDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new LeaveValidationError(`날짜 형식이 올바르지 않습니다: ${s}`);
  const date = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new LeaveValidationError(`유효하지 않은 날짜입니다: ${s}`);
  return date;
}

/** ANNUAL=주말·공휴일 제외 일수, HALF=0.5, QUARTER=0.25. UTC 기준 결정적. */
export function calculateLeaveDays(leaveType: LeaveType, start: Date, end: Date, holidays: Set<string>): number {
  if (leaveType === "HALF") return 0.5;
  if (leaveType === "QUARTER") return 0.25;
  let count = 0;
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (cur.getTime() <= last) {
    const day = cur.getUTCDay(); // 0=일, 6=토
    if (day !== 0 && day !== 6 && !holidays.has(toDateKey(cur))) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/** 직원: 과거 신청 불가 + start>end 불가. */
export function validateDates(start: Date, end: Date, today: Date): void {
  if (toDateKey(start) < toDateKey(today)) throw new LeaveValidationError("과거 날짜에는 연차를 신청할 수 없습니다.");
  if (start.getTime() > end.getTime()) throw new LeaveValidationError("시작일은 종료일보다 이전이어야 합니다.");
}

/** 관리자: start>end만 불가(과거 허용). */
export function validateDatesForAdmin(start: Date, end: Date): void {
  if (start.getTime() > end.getTime()) throw new LeaveValidationError("시작일은 종료일보다 이전이어야 합니다.");
}

/** HALF/QUARTER는 단일일만. */
export function validateLeaveTypeDates(leaveType: LeaveType, start: Date, end: Date): void {
  if ((leaveType === "HALF" || leaveType === "QUARTER") && toDateKey(start) !== toDateKey(end)) {
    throw new LeaveValidationError(`${leaveType === "HALF" ? "반차" : "반반차"}는 하루만 선택할 수 있습니다.`);
  }
}

/** 이월 만료 = 익년 6/30(UTC 자정). */
export function calculateCarriedOverExpiry(year: number): Date {
  return new Date(Date.UTC(year + 1, 5, 30));
}

/** 현재 KST 날짜를 UTC 자정 Date로(validateDates·취소 게이트의 today 인자용). */
export function kstToday(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
}
```

```
npm test -- tests/modules/leave/rules   # expect PASS
```

### 5. 커밋
```
git add src/modules/leave/types.ts src/modules/leave/errors.ts src/modules/leave/rules.ts tests/modules/leave/rules.test.ts
git commit -m "feat(leave): 순수 도메인 규칙·타입·에러(일수 계산 공휴일 제외)"
```

## Acceptance Criteria
- `npm test -- tests/modules/leave/rules` → PASS(전 케이스).
- `npm run typecheck` / `npm run lint` → 그린.

## Cautions
- **Don't `getDay()`/`getDate()`(로컬 TZ)·date-fns `isWeekend`를 쓰지 말 것.** Reason: 서버 TZ에 따라 요일·날짜가 밀린다. `getUTCDay()`/UTC 슬라이스로 통일.
- **Don't rules에 prisma·now()·공휴일 조회를 넣지 말 것.** Reason: 순수성·결정적 테스트가 깨진다. 공휴일 Set·today는 호출부(서비스)가 주입.
- **Don't "마이너스 연차" 검사를 rules에 넣지 말 것.** Reason: POC는 잔여 부족도 허용(경고만) — 거부 로직 추가 금지(spec §5).
