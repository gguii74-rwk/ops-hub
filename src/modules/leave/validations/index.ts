import { z } from "zod";
import { QUARTER_START_TIMES } from "@/modules/leave/labels";
import { expectedUpdatedAt } from "@/kernel/optimistic";

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

// 낙관적 동시성 body 스키마(stale-tab lost-update 차단) — updateByAdmin 라우트가 쓴다(도메인 스키마 보존).
// updatedAt = 클라가 본 신청 행 버전. 라우트가 추출해 service에 expectedUpdatedAt: Date로 넘긴다.
export const updateLeaveBodySchema = updateLeaveSchema.extend({ updatedAt: expectedUpdatedAt });

// 관리자 삭제: 사유 필수(되돌릴 수 없는 작업·감사 메타). DELETE 라우트가 safeParse→400으로 강제 —
// UI 사유필수는 UX일 뿐 API도 같은 검사(접근제어 규칙 #1). trim 후 빈 문자열도 거부.
export const deleteLeaveSchema = z.object({
  reason: z.string().trim().min(1, "삭제 사유는 필수입니다.").max(1000),
});

export const rejectSchema = z.object({ rejectionReason: z.string().min(1).max(500) });
export const cancelSchema = z.object({ cancellationReason: z.string().max(500).nullish() });

export const upsertAllocationSchema = z.object({
  allocatedDays: z.number().min(0),
  carriedOverDays: z.number().min(0).default(0),
  carriedOverExpiryDate: dateStr.nullish(),
});

export const adjustAllocationSchema = z.object({
  changeDays: z.number().positive(), // 양수 크기. 부호는 changeType이 결정(ADD=+, DEDUCT=-)
  changeType: z.enum(["ADD", "DEDUCT"]),
  reason: z.string().min(1).max(200),
  reasonDetail: z.string().max(500).nullish(),
});
