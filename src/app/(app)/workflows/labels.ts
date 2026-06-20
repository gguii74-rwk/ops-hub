export type WfStatus = "PENDING" | "GENERATED" | "REVIEWED" | "SENT" | "HQ_REQUESTED" | "FINAL_SENT" | "CANCELLED";
export type MailStatus = "PENDING" | "SENDING" | "SENT" | "FAILED" | "CANCELLED";
type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

export const KIND_LABEL: Record<string, string> = {
  WEEKLY_REPORT: "주간보고",
  BILLING: "대금청구",
  NOTIFICATION_BILLING: "알림톡",
};

export const STATUS_LABEL: Record<WfStatus, string> = {
  PENDING: "대기", GENERATED: "생성됨", REVIEWED: "검토됨", SENT: "발송됨",
  HQ_REQUESTED: "본사요청", FINAL_SENT: "최종발송", CANCELLED: "취소됨",
};
export const STATUS_VARIANT: Record<WfStatus, BadgeVariant> = {
  PENDING: "outline", GENERATED: "secondary", REVIEWED: "secondary", SENT: "default",
  HQ_REQUESTED: "secondary", FINAL_SENT: "default", CANCELLED: "destructive",
};

// 메일 배지: SENDING은 '확인 필요'(발송 불확실)로 표시(spec §10). PENDING/CANCELLED는 공유 테이블의 leave 메일용 — 워크플로엔 거의 안 나타나나 타입·렌더 커버.
export const MAIL_LABEL: Record<MailStatus, string> = { PENDING: "대기 중", SENDING: "확인 필요", SENT: "발송됨", FAILED: "실패", CANCELLED: "취소됨" };
export const MAIL_VARIANT: Record<MailStatus, BadgeVariant> = { PENDING: "outline", SENDING: "outline", SENT: "default", FAILED: "destructive", CANCELLED: "secondary" };

// 취소 가능 상태(서버가 최종 권위 — UI는 힌트). terminal·발송 이후는 숨김.
export const CANCELLABLE: WfStatus[] = ["PENDING", "GENERATED", "REVIEWED"];
