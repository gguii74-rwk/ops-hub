import type { WorkflowKind, WorkflowStatus } from "@prisma/client";

// 워크플로 종류별 허용 전이. 명시되지 않은 전이는 거부(fail-closed).
export const TRANSITIONS: Record<WorkflowKind, Partial<Record<WorkflowStatus, WorkflowStatus[]>>> = {
  WEEKLY_REPORT: { PENDING: ["GENERATED", "CANCELLED"], GENERATED: ["SENT", "CANCELLED"] },
  BILLING: {
    PENDING: ["GENERATED", "CANCELLED"],
    GENERATED: ["SENT", "CANCELLED"],
    SENT: ["HQ_REQUESTED"],
    HQ_REQUESTED: ["FINAL_SENT"],
  },
  NOTIFICATION_BILLING: {
    PENDING: ["GENERATED", "CANCELLED"],
    GENERATED: ["REVIEWED", "SENT", "CANCELLED"],
    REVIEWED: ["HQ_REQUESTED"],
    HQ_REQUESTED: ["FINAL_SENT"],
  },
};

// 권한 검사용 리소스 매핑.
export const KIND_RESOURCE: Record<WorkflowKind, string> = {
  WEEKLY_REPORT: "workflows.weekly",
  BILLING: "workflows.billing",
  NOTIFICATION_BILLING: "workflows.notification",
};

// 전이 대상 → 요구 권한 액션.
export const ACTION_FOR_STATUS: Partial<Record<WorkflowStatus, string>> = {
  GENERATED: "generate",
  REVIEWED: "review",
  SENT: "send",
  HQ_REQUESTED: "send",
  FINAL_SENT: "send",
  CANCELLED: "view",
};

// toStatus → stamp할 WorkflowTask 컬럼(없으면 stamp 안 함, §4.3).
export const STAMP_FOR_STATUS: Partial<Record<WorkflowStatus, "generatedAt" | "reviewedAt" | "sentAt">> = {
  GENERATED: "generatedAt",
  REVIEWED: "reviewedAt",
  SENT: "sentAt",
};
