export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

export const TYPE_LABEL: Record<string, string> = { ANNUAL: "연차", HALF: "반차", QUARTER: "반반차" };
export const SUBTYPE_LABEL: Record<string, string> = { MORNING: "오전", AFTERNOON: "오후" };
export const STATUS_LABEL: Record<LeaveStatus, string> = { PENDING: "대기", APPROVED: "승인", REJECTED: "반려", CANCELLED: "취소" };
export const STATUS_VARIANT: Record<LeaveStatus, BadgeVariant> = {
  PENDING: "outline", APPROVED: "default", REJECTED: "destructive", CANCELLED: "secondary",
};
