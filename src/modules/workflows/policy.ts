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

// 다운로드 가능 상태 = 산출물 생성 이후·미취소 상태(PENDING 미생성·CANCELLED 취소 제외).
// 서버 다운로드 게이트(services/download.ts)와 UI 다운로드 링크 노출(workflow-detail.tsx)이 동일 불변식을 공유한다(드리프트 방지).
export const DOWNLOADABLE_STATUSES = new Set<WorkflowStatus>([
  "GENERATED", "REVIEWED", "SENT", "HQ_REQUESTED", "FINAL_SENT",
]);
export function isDownloadableStatus(status: string): boolean {
  return (DOWNLOADABLE_STATUSES as Set<string>).has(status);
}

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

// 단계별 발송이 성공했을 때 적용할 워크플로 전이 (kind, step → from/to). 단일 출처:
// send(happy-path)와 retry/resolve(복구 경로)가 모두 이 매핑을 써서 발송 성공 시 동일 전이를 적용한다.
// 미정의 kind/step(예: leave·step=null)은 전이 없음 → 복구는 plain finalize(SENT) 유지.
export const SEND_STEP_TRANSITION: Partial<Record<WorkflowKind, Record<string, { from: WorkflowStatus; to: WorkflowStatus }>>> = {
  BILLING: {
    "1": { from: "GENERATED", to: "SENT" },
    "2": { from: "SENT", to: "HQ_REQUESTED" },
  },
};

export function sendStepTransition(
  kind: WorkflowKind | null,
  step: string | null,
): { from: WorkflowStatus; to: WorkflowStatus } | null {
  if (!kind || step == null) return null;
  return SEND_STEP_TRANSITION[kind]?.[step] ?? null;
}
