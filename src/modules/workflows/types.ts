import type { WorkflowKind, WorkflowStatus, WorkflowTask } from "@prisma/client";

/** 조건부 업데이트 경합·멱등 가드 위반 → API 409. */
export class ConflictError extends Error {
  constructor(message = "상태가 이미 변경되었습니다.") {
    super(message);
    this.name = "ConflictError";
  }
}

/** 전이/생성/취소 권한 컨텍스트. permissionKeys = getPermissionSummary().keys → Set. */
export interface TransitionCtx {
  userId: string;
  isOwner: boolean;
  permissionKeys: Set<string>;
  note?: string;
}

/** 메일 재시도/해소 권한 컨텍스트. isAdmin = systemRole OWNER||ADMIN (resolve 전용). */
export interface MailActionCtx {
  userId: string;
  isOwner: boolean;
  isAdmin: boolean;
  permissionKeys: Set<string>;
}

/** 문서 생성 포트 — 계약만. 구현체는 후속 sub-project가 자기 모듈에 둔다(spec §11). */
export interface GeneratorResult {
  files: Array<{ path: string; displayName: string; mimeType?: string; sizeBytes?: number }>;
}
export interface GeneratorPort {
  kind: WorkflowKind;
  generate(task: WorkflowTask): Promise<GeneratorResult>;
}

// 정책에서 쓰는 보조 별칭(소비처 가독성용).
export type { WorkflowKind, WorkflowStatus };
