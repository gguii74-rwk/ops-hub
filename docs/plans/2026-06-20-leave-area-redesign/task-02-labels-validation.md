# Task 02 — labels(표시 헬퍼·QUARTER_TIME_SLOTS) + validation 6종 강화

**목적:** 원본 `utils.ts`의 연차 표시 헬퍼와 반반차 시간대 6종을 `src/modules/leave/labels.ts`로 단일화하고, zod 검증을 6종 화이트리스트 + 유형별 필수 규칙으로 강화한다.

## Files
- Create: `src/modules/leave/labels.ts` (SSOT — 상수·헬퍼)
- Modify: `src/app/(app)/leave/labels.ts` (modules에서 re-export로 축소 — 기존 import 호환)
- Modify: `src/modules/leave/validations/index.ts`
- Create: `tests/modules/leave/labels.test.ts`
- Create: `tests/modules/leave/validations.test.ts`

## Prep
- 엔트리포인트 §SC-5(표시 헬퍼·상수).
- 원본: `C:\workspace\annual-leave\frontend\src\lib\utils.ts`(getLeaveTypeText/getLeaveSubTypeText/getQuarterEndTime/getQuarterTimeText/getFullLeaveText), 시간대 6종은 원본 모달에 하드코딩.
- 기존 `src/app/(app)/leave/labels.ts`: `TYPE_LABEL/SUBTYPE_LABEL/STATUS_LABEL/STATUS_VARIANT/LeaveStatus` — `my-requests.tsx`·`approvals-client.tsx`가 import 중. **깨지 않게 re-export로 보존.**
- 기존 `src/modules/leave/validations/index.ts`(line 5~27): createLeaveSchema/adminCreateLeaveSchema/updateLeaveSchema가 `quarterStartTime: z.string().regex(/^\d{2}:\d{2}$/)`.

## Deps
없음. (Task 01과 독립 — 병렬 가능.)

## Steps

### 1. (TDD) labels 테스트 작성 → FAIL

`tests/modules/leave/labels.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  QUARTER_TIME_SLOTS, QUARTER_START_TIMES,
  getLeaveTypeText, getLeaveSubTypeText, getQuarterEndTime, getQuarterTimeText, getFullLeaveText,
} from "@/modules/leave/labels";

describe("leave labels — 시간대", () => {
  it("반반차 6종 시작시각", () => {
    expect(QUARTER_START_TIMES).toEqual(["09:00", "10:00", "11:00", "13:00", "15:00", "16:00"]);
    expect(QUARTER_TIME_SLOTS).toHaveLength(6);
  });
  it("getQuarterEndTime: 11시는 점심 포함 14:00, 그 외 +2h", () => {
    expect(getQuarterEndTime("11:00")).toBe("14:00");
    expect(getQuarterEndTime("09:00")).toBe("11:00");
    expect(getQuarterEndTime("16:00")).toBe("18:00");
  });
  it("getQuarterTimeText", () => {
    expect(getQuarterTimeText("13:00")).toBe("13:00~15:00");
    expect(getQuarterTimeText("11:00")).toBe("11:00~14:00");
  });
});

describe("leave labels — 표시 텍스트", () => {
  it("getLeaveTypeText / getLeaveSubTypeText", () => {
    expect(getLeaveTypeText("ANNUAL")).toBe("연차");
    expect(getLeaveTypeText("HALF")).toBe("반차");
    expect(getLeaveTypeText("QUARTER")).toBe("반반차");
    expect(getLeaveSubTypeText("MORNING")).toBe("오전 반차");
    expect(getLeaveSubTypeText("AFTERNOON")).toBe("오후 반차");
  });
  it("getFullLeaveText: 유형+세부 결합", () => {
    expect(getFullLeaveText("ANNUAL")).toBe("연차");
    expect(getFullLeaveText("HALF", "MORNING")).toBe("오전 반차");
    expect(getFullLeaveText("QUARTER", null, "09:00")).toBe("반반차 09:00~11:00");
  });
});
```
실행: `npx vitest run tests/modules/leave/labels.test.ts` → **FAIL**(모듈 없음).

### 2. labels.ts 작성 → PASS

`src/modules/leave/labels.ts`(서버·클라이언트 공유 — `server-only`/`use server` 금지):
```ts
// 연차 표시 헬퍼·상수 단일 출처(SSOT). 원본 annual-leave/frontend/src/lib/utils.ts 로직 포팅.
// 서버 컴포넌트·클라이언트 컴포넌트·검증이 함께 import하므로 순수 TS만 둔다.

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

export const TYPE_LABEL: Record<string, string> = { ANNUAL: "연차", HALF: "반차", QUARTER: "반반차" };
export const SUBTYPE_LABEL: Record<string, string> = { MORNING: "오전", AFTERNOON: "오후" };
export const STATUS_LABEL: Record<LeaveStatus, string> = { PENDING: "대기", APPROVED: "승인", REJECTED: "반려", CANCELLED: "취소" };
export const STATUS_VARIANT: Record<LeaveStatus, BadgeVariant> = {
  PENDING: "outline", APPROVED: "default", REJECTED: "destructive", CANCELLED: "secondary",
};

// 반반차 고정 6종 시간대(원본 SSOT). 폼·검증·표시가 공유.
export const QUARTER_TIME_SLOTS = [
  { start: "09:00", end: "11:00", label: "09:00 ~ 11:00" },
  { start: "10:00", end: "12:00", label: "10:00 ~ 12:00" },
  { start: "11:00", end: "14:00", label: "11:00 ~ 14:00 (점심 포함)" },
  { start: "13:00", end: "15:00", label: "13:00 ~ 15:00" },
  { start: "15:00", end: "17:00", label: "15:00 ~ 17:00" },
  { start: "16:00", end: "18:00", label: "16:00 ~ 18:00" },
] as const;

export const QUARTER_START_TIMES: readonly string[] = QUARTER_TIME_SLOTS.map((s) => s.start);

export function getLeaveTypeText(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

export function getLeaveSubTypeText(subType: string): string {
  return subType === "MORNING" ? "오전 반차" : subType === "AFTERNOON" ? "오후 반차" : subType;
}

// 원본 getQuarterEndTime: 11시 시작은 점심(12~13시) 포함 14:00, 그 외 +2시간.
export function getQuarterEndTime(startTime: string): string {
  const hours = Number(startTime.split(":")[0]);
  if (hours === 11) return "14:00";
  return `${String(hours + 2).padStart(2, "0")}:00`;
}

export function getQuarterTimeText(startTime: string): string {
  return `${startTime}~${getQuarterEndTime(startTime)}`;
}

export function getFullLeaveText(leaveType: string, leaveSubType?: string | null, quarterStartTime?: string | null): string {
  if (leaveType === "HALF" && leaveSubType) return getLeaveSubTypeText(leaveSubType);
  if (leaveType === "QUARTER" && quarterStartTime) return `반반차 ${getQuarterTimeText(quarterStartTime)}`;
  return getLeaveTypeText(leaveType);
}
```
실행: 1번 테스트 → **PASS**.

### 3. 기존 (app)/leave/labels.ts를 re-export로 축소

`src/app/(app)/leave/labels.ts` 전체 교체:
```ts
// 표시 상수·타입의 단일 출처는 src/modules/leave/labels.ts. 기존 import 경로 호환을 위해 re-export.
export * from "@/modules/leave/labels";
```
**주의:** `my-requests.tsx`는 `LeaveStatus` 타입을 import한다 — re-export에 포함되는지 확인(위 `export *`로 포함됨).

### 4. (TDD) validation 테스트 작성 → FAIL

`tests/modules/leave/validations.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createLeaveSchema, updateLeaveSchema, deleteLeaveSchema } from "@/modules/leave/validations";

const base = { startDate: "2026-07-01", endDate: "2026-07-01" };

describe("createLeaveSchema — 반반차 화이트리스트", () => {
  it("6종 외 시작시각 거부", () => {
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "QUARTER", quarterStartTime: "12:00" }).success).toBe(false);
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "QUARTER", quarterStartTime: "09:30" }).success).toBe(false);
  });
  it("6종 중 하나는 통과", () => {
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "QUARTER", quarterStartTime: "11:00" }).success).toBe(true);
  });
  it("QUARTER인데 quarterStartTime 없으면 거부", () => {
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "QUARTER" }).success).toBe(false);
  });
  it("HALF인데 leaveSubType 없으면 거부", () => {
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "HALF" }).success).toBe(false);
  });
  it("HALF + MORNING 통과", () => {
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "HALF", leaveSubType: "MORNING" }).success).toBe(true);
  });
  it("ANNUAL은 sub 필드 불필요", () => {
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "ANNUAL" }).success).toBe(true);
  });
});

describe("updateLeaveSchema — 화이트리스트만(부분 수정)", () => {
  it("6종 외 시각 거부", () => {
    expect(updateLeaveSchema.safeParse({ quarterStartTime: "08:00" }).success).toBe(false);
  });
  it("빈 패치 허용(부분 수정)", () => {
    expect(updateLeaveSchema.safeParse({}).success).toBe(true);
  });
});

describe("deleteLeaveSchema — 삭제 사유 필수", () => {
  it("사유 누락 거부", () => {
    expect(deleteLeaveSchema.safeParse({}).success).toBe(false);
  });
  it("공백만인 사유 거부(trim 후 빈 문자열)", () => {
    expect(deleteLeaveSchema.safeParse({ reason: "   " }).success).toBe(false);
  });
  it("비어있지 않은 사유 통과", () => {
    expect(deleteLeaveSchema.safeParse({ reason: "오기재 정정" }).success).toBe(true);
  });
});
```
실행 → **FAIL**(아직 `12:00` 등이 통과).

### 5. validations 강화 → PASS

`src/modules/leave/validations/index.ts` line 1~27을 교체:
```ts
import { z } from "zod";
import { QUARTER_START_TIMES } from "@/modules/leave/labels";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다.");

// 반반차 시작시각은 고정 6종 화이트리스트(SSOT: labels.ts). refine으로 타입 충돌 없이 검증.
const QUARTER_SET = new Set(QUARTER_START_TIMES);
const quarterStart = z
  .string()
  .refine((v) => QUARTER_SET.has(v), "허용되지 않은 반반차 시작 시각입니다.")
  .nullish();

const leaveFields = {
  leaveType: z.enum(["ANNUAL", "HALF", "QUARTER"]),
  leaveSubType: z.enum(["MORNING", "AFTERNOON"]).nullish(),
  quarterStartTime: quarterStart,
  startDate: dateStr,
  endDate: dateStr,
  reason: z.string().max(1000).nullish(),
};

// QUARTER↔quarterStartTime, HALF↔leaveSubType 필수 규칙(서버측 게이트). 클라이언트도 동일 UX(Task 12).
const requireSubFields = (
  d: { leaveType: "ANNUAL" | "HALF" | "QUARTER"; leaveSubType?: unknown; quarterStartTime?: unknown },
  ctx: z.RefinementCtx,
) => {
  if (d.leaveType === "QUARTER" && !d.quarterStartTime)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quarterStartTime"], message: "반반차는 시작 시각이 필요합니다." });
  if (d.leaveType === "HALF" && !d.leaveSubType)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["leaveSubType"], message: "반차는 오전/오후 선택이 필요합니다." });
};

const baseLeave = z.object(leaveFields);

export const createLeaveSchema = baseLeave.superRefine(requireSubFields);

export const adminCreateLeaveSchema = baseLeave
  .extend({ userId: z.string().min(1), sendNotification: z.boolean().optional() })
  .superRefine(requireSubFields);

export const updateLeaveSchema = z.object({
  leaveType: z.enum(["ANNUAL", "HALF", "QUARTER"]).optional(),
  leaveSubType: z.enum(["MORNING", "AFTERNOON"]).nullish(),
  quarterStartTime: quarterStart,
  startDate: dateStr.optional(),
  endDate: dateStr.optional(),
  reason: z.string().max(1000).nullish(),
  adminActionNote: z.string().max(500).nullish(),
});

// 관리자 삭제: 사유 필수(되돌릴 수 없는 작업·감사 메타). DELETE 라우트가 safeParse→400으로 강제 —
// UI 사유필수는 UX일 뿐 API도 같은 검사(접근제어 규칙 #1). trim 후 빈 문자열도 거부.
export const deleteLeaveSchema = z.object({
  reason: z.string().trim().min(1, "삭제 사유는 필수입니다.").max(1000),
});
```
**나머지(rejectSchema/cancelSchema/upsertAllocationSchema/adjustAllocationSchema, line 29~)는 그대로 둔다.**

실행: 4번 테스트 + 기존 `tests/modules/leave/*` → **PASS**.

## Acceptance Criteria
- `npx vitest run tests/modules/leave/labels.test.ts tests/modules/leave/validations.test.ts` → all passed.
- `npm test` → 회귀 없음(기존 requests-service/rules 테스트 포함 green).
- `npm run typecheck` → 0 errors.
- `npm run lint` → 통과(boundaries: modules→app import 금지 규칙 위반 없음 — labels는 modules에 둠).

## Cautions
- **Don't** `src/modules/leave/labels.ts`에 `server-only`나 `"use server"`를 넣지 마라. 이유: 클라이언트 컴포넌트(폼·모달·캘린더)가 직접 import한다.
- **Don't** `createLeaveSchema`에 `.superRefine` 후 `.extend`를 시도하지 마라. 이유: ZodEffects는 `.extend`가 없다 — `baseLeave`(ZodObject)를 extend한 뒤 각각 superRefine한다.
- **Don't** `updateLeaveSchema`에 필수 규칙(superRefine)을 걸지 마라. 이유: 관리자 수정은 부분 패치이고 service가 기존값으로 fallback한다(`updateByAdmin`).
