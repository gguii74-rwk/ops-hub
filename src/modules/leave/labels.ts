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
