# Phase 4 — Workflows 공통 기반 (구현 계획 엔트리포인트)

- Spec: `docs/specs/2026-06-19-phase-4-workflows-core-design.md`
- Goal: day-sync 업무 자동화의 **공통 기반**(lifecycle 전이 엔진·메일 인프라·이력·timeline shell·문서 생성 포트)을 ops-hub에 구축한다. 실제 문서 생성기·발송 orchestration은 후속 sub-project가 채운다.
- Architecture: `src/modules/workflows`에 정책 데이터(`policy.ts`)·타입(`types.ts`)·repository(Prisma 직접)·service(lifecycle/tasks/mail/generator)를 두고, 메일 전송은 `src/lib/integrations/mail`(lib, 워크플로 sub-project 공유)에 둔다. 전이는 선언적 테이블 주입 + 단일 엔진이 fail-closed로 검증·기록하고, 조건부 `updateMany`(0행→409)로 원자 전이를 보장한다. 메일은 동기 발송 + `SENDING→SENT/FAILED` 단일-갱신 + `(taskId,step)` 멱등으로 중복 SMTP를 foundation에서 막는다. UI는 React Query 기반 목록 + timeline shell.
- Tech Stack: Next.js App Router, Prisma(multiSchema, PostgreSQL), `nodemailer`(기설치), `@tanstack/react-query`(기설치), zod, vitest(node), Tailwind v4 + 기존 ui 프리미티브.

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-19-phase-4-workflows-core/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

## Shared Contracts

이 절은 2개 이상 태스크가 참조하는 스키마·타입·시그니처·정책의 단일 출처다. 태스크 파일은 이들을 재정의하지 않고 "엔트리포인트 §Shared Contracts"를 가리킨다(공유 타입 정의의 유일한 예외 절). 함수 **구현 본문**은 각 태스크에 full inline으로 둔다.

### SC-1. 스키마 변경 (Task 01, migration 1건)

`schema.prisma`에 추가/변경. 기존 `WorkflowType`/`WorkflowTask`/`GeneratedFile`/`BillingConfig`의 기존 컬럼은 변경하지 않는다(파괴적 migration 회피).

```prisma
enum MailDeliveryStatus {
  SENDING
  SENT
  FAILED

  @@schema("workflows")
}

model WorkflowTaskEvent {
  id         String          @id @default(cuid())
  taskId     String
  task       WorkflowTask    @relation(fields: [taskId], references: [id], onDelete: Cascade)
  fromStatus WorkflowStatus?
  toStatus   WorkflowStatus
  actorId    String?
  note       String?
  occurredAt DateTime        @default(now())

  @@index([taskId, occurredAt])
  @@schema("workflows")
}
```

`WorkflowTask`에 역관계 한 줄 추가: `events WorkflowTaskEvent[]`.

`MailDelivery`에 추가/변경:
- `status MailDeliveryStatus` (default 없음 — 앱이 항상 명시)
- `errorMessage String?`
- `bodyHtml String?`
- `sentAt DateTime?` (기존 `DateTime @default(now())` → nullable + default 제거)
- 역관계/기타 기존 컬럼(`step`/`recipients`/`subject`/`attachmentPaths`/`providerMessageId`/`sentById`)은 유지.

**migration SQL은 hand-author**(Task 01에 full SQL). DB 없이도 `prisma validate`/`prisma generate`/`typecheck`가 통과하며, 실제 `prisma migrate` 적용은 기존 관례대로 DB 연결 시 수행(deferred). 부분 unique 인덱스(`(taskId, step) WHERE taskId IS NOT NULL AND status IN ('SENDING','SENT')`)는 같은 migration의 raw SQL.

### SC-2. 모듈 에러·컨텍스트·포트 타입 (`src/modules/workflows/types.ts`, Task 02)

```ts
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

/** 문서 생성 포트 — 계약만. 구현체는 후속 sub-project가 자기 모듈에 둔다(§11). */
export interface GeneratorResult {
  files: Array<{ path: string; displayName: string; mimeType?: string; sizeBytes?: number }>;
}
export interface GeneratorPort {
  kind: WorkflowKind;
  generate(task: WorkflowTask): Promise<GeneratorResult>;
}
```

### SC-3. 정책 데이터 (`src/modules/workflows/policy.ts`, Task 02)

```ts
import type { WorkflowKind, WorkflowStatus } from "@prisma/client";

// 워크플로 종류별 허용 전이. 명시되지 않은 전이는 거부(fail-closed).
export const TRANSITIONS: Record<WorkflowKind, Partial<Record<WorkflowStatus, WorkflowStatus[]>>> = {
  WEEKLY_REPORT:        { PENDING: ["GENERATED", "CANCELLED"], GENERATED: ["SENT", "CANCELLED"] },
  BILLING:              { PENDING: ["GENERATED", "CANCELLED"], GENERATED: ["SENT", "CANCELLED"],
                          SENT: ["HQ_REQUESTED"], HQ_REQUESTED: ["FINAL_SENT"] },
  NOTIFICATION_BILLING: { PENDING: ["GENERATED", "CANCELLED"], GENERATED: ["REVIEWED", "SENT", "CANCELLED"],
                          REVIEWED: ["HQ_REQUESTED"], HQ_REQUESTED: ["FINAL_SENT"] },
};

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

// toStatus → stamp할 WorkflowTask 컬럼(없으면 stamp 안 함).
export const STAMP_FOR_STATUS: Partial<Record<WorkflowStatus, "generatedAt" | "reviewedAt" | "sentAt">> = {
  GENERATED: "generatedAt",
  REVIEWED: "reviewedAt",
  SENT: "sentAt",
};
```

> 정책 데이터는 모든 kind를 한 파일에 둔다(공통 기반이 전이 검증을 소유). 후속 sub-project는 부수효과 orchestration만 추가하고 정책을 재정의하지 않는다. **누락 권한 키 주의**: `workflows.notification:review`/`:generate` 등은 `seed-permissions.ts`에 아직 없다 — 공통 기반은 `weekly`의 기존 `generate`/`send`로만 엔진·authz를 검증하고, 누락분은 해당 sub-project가 `EXTRA_PERMISSIONS`에 추가한다(§7). 정책 테이블이 액션 문자열을 *참조*하는 것은 권한 행 존재를 요구하지 않는다.

### SC-4. workflow-task repository 시그니처 (`src/modules/workflows/repositories/index.ts`, Task 03)

Prisma 직접 접근은 `repositories/`에서만(boundaries). 모든 함수는 `@/lib/prisma`를 쓴다.

```ts
import type { WorkflowKind, WorkflowStatus, MailDelivery } from "@prisma/client";
import type { GeneratorResult } from "../types";

export interface TaskListRow { id: string; kind: WorkflowKind; typeName: string; scheduledAt: Date; status: WorkflowStatus; }
export interface TaskListFilter { kinds: WorkflowKind[]; statuses?: WorkflowStatus[]; start?: Date; end?: Date; }
export interface FileRow { id: string; path: string; displayName: string; mimeType: string | null; sizeBytes: bigint | null; createdAt: Date; }
export interface MailRow { id: string; step: string | null; recipients: unknown; subject: string; status: MailDeliveryStatus; errorMessage: string | null; providerMessageId: string | null; sentAt: Date | null; }
export interface EventRow { id: string; fromStatus: WorkflowStatus | null; toStatus: WorkflowStatus; actorId: string | null; note: string | null; occurredAt: Date; }
export interface TaskDetailRow {
  id: string; kind: WorkflowKind; typeName: string; scheduledAt: Date; status: WorkflowStatus;
  createdById: string | null; outputPath: string | null;
  files: FileRow[]; mailDeliveries: MailRow[]; events: EventRow[];
}
export interface TaskForTransition { id: string; status: WorkflowStatus; createdById: string | null; kind: WorkflowKind; }

export function findTaskList(filter: TaskListFilter): Promise<TaskListRow[]>;
export function findTaskDetail(id: string): Promise<TaskDetailRow | null>;
export function findTaskForTransition(id: string): Promise<TaskForTransition | null>;
export function findWorkflowTypeKind(typeId: string): Promise<WorkflowKind | null>;
export function createTaskWithInitialEvent(input: { typeId: string; scheduledAt: Date; createdById: string }): Promise<{ id: string }>;
// 조건부·원자 전이. updateMany(where status=fromStatus) 1행 갱신 시에만 이벤트 기록. 갱신 0행이면 false(엔진이 ConflictError).
export function applyTransitionAtomic(args: {
  taskId: string; fromStatus: WorkflowStatus; toStatus: WorkflowStatus;
  actorId: string; note?: string; stampField: "generatedAt" | "reviewedAt" | "sentAt" | null;
}): Promise<boolean>;
export function createGeneratedFiles(taskId: string, files: GeneratorResult["files"]): Promise<void>;
// 활성(SENDING) 발송이 있는지 — cancel 게이트(§5.2).
export function hasActiveSending(taskId: string): Promise<boolean>;
```

### SC-5. mail repository 시그니처 (`src/modules/workflows/repositories/mail.ts`, Task 06)

```ts
import type { MailDelivery, MailDeliveryStatus, WorkflowKind } from "@prisma/client";

export interface DeliveryForAction {
  id: string; taskId: string | null; step: string | null; status: MailDeliveryStatus;
  recipients: string[]; subject: string; bodyHtml: string | null; attachmentPaths: string[];
  kind: WorkflowKind | null; // task→type.kind (없으면 null)
}

// (taskId,step) 멱등 가드(tx 내 findFirst 활성 + create). 경합 시 P2002 → ConflictError. status=SENDING, sentAt=null로 생성.
export function createSendingDelivery(args: {
  taskId: string | null; step: string | null; recipients: string[]; subject: string;
  bodyHtml: string; attachmentPaths: string[]; sentById: string;
}): Promise<MailDelivery>;
// 같은 레코드를 정확히 1회 SENT/FAILED로 갱신.
export function finalizeDelivery(id: string, patch: {
  status: "SENT" | "FAILED"; sentAt: Date | null; providerMessageId?: string | null; errorMessage?: string | null;
}): Promise<MailDelivery>;
export function findDeliveryForAction(deliveryId: string): Promise<DeliveryForAction | null>;
```

### SC-6. service 시그니처

```ts
// services/lifecycle.ts (Task 04)
export function transitionTask(taskId: string, to: WorkflowStatus, ctx: TransitionCtx): Promise<void>;
export function createTask(input: { typeId: string; scheduledAt: Date }, ctx: TransitionCtx): Promise<{ id: string }>;
export function cancelTask(taskId: string, ctx: TransitionCtx): Promise<void>;

// services/tasks.ts (Task 07) — read·DTO 조립. kind 권한 없는 항목은 제외/거부.
export interface TaskListItem { id: string; kind: WorkflowKind; typeName: string; scheduledAt: string; status: WorkflowStatus; }
export interface TimelineEntry { id: string; fromStatus: WorkflowStatus | null; toStatus: WorkflowStatus; actorId: string | null; note: string | null; occurredAt: string; }
export interface MailView { id: string; step: string | null; recipients: string[]; subject: string; status: MailDeliveryStatus; errorMessage: string | null; sentAt: string | null; }
export interface FileView { id: string; displayName: string; mimeType: string | null; sizeBytes: number | null; createdAt: string; }
export interface TaskDetailView {
  id: string; kind: WorkflowKind; typeName: string; scheduledAt: string; status: WorkflowStatus;
  files: FileView[]; mailDeliveries: MailView[]; timeline: TimelineEntry[];
}
export function getTaskList(ctx: { permissionKeys: Set<string> }, filter: { statuses?: WorkflowStatus[]; start?: Date; end?: Date }): Promise<TaskListItem[]>;
export function getTaskDetailView(id: string, ctx: { permissionKeys: Set<string> }): Promise<TaskDetailView | null>; // null=미존재(라우트 404), ForbiddenError=해당 kind :view 없음(403)

// services/generator.ts (Task 07)
export function recordGeneratedFiles(taskId: string, result: GeneratorResult): Promise<void>;

// services/mail.ts (Task 06)
export function deliver(args: { taskId: string | null; step: string | null; msg: MailMessage; sentById: string }): Promise<MailDelivery>;
export function retryDelivery(args: { deliveryId: string; taskId: string }, ctx: MailActionCtx): Promise<MailDelivery>;
export function resolveDelivery(args: { deliveryId: string; taskId: string; to: "SENT" | "FAILED" }, ctx: MailActionCtx): Promise<MailDelivery>;
```

### SC-7. 메일 전송 lib (`src/lib/integrations/mail/index.ts`, Task 05)

boundaries상 lib는 module 타입을 import하지 않는다. 순수 전송만(이력 기록 없음).

```ts
export interface MailAttachment { filename: string; path: string; contentType?: string; }
export interface MailMessage { to: string[]; subject: string; html: string; attachments?: MailAttachment[]; }
export interface SendResult { providerMessageId: string | null; }

export function sendMail(msg: MailMessage): Promise<SendResult>;
// 테스트 전용 transport 주입(실제 SMTP 대신 fake). null로 리셋.
export function setMailTransportForTests(t: MailTransport | null): void;
export interface MailTransport { sendMail(opts: { from: string; to: string; subject: string; html: string; attachments?: MailAttachment[] }): Promise<{ messageId?: string }>; }
```

SMTP 설정 env(모두 optional, 미설정 시 전송 시점에 에러): `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`. `lib/env/schema.ts`에 optional로 추가(Task 05).

### SC-8. 권한 키·컨텍스트 구성 (라우트 공통, Task 09)

- 목록·상세 = `workflows.<kind>:view`, 생성 = `workflows.<kind>:create`, 취소 = `<kind>:view` + 본인/OWNER 게이트, 메일 재시도 = `<kind>:send`, resolve = admin(OWNER/ADMIN).
- 라우트는 세션에서 ctx를 구성한다(OWNER는 `getPermissionSummary`가 전체 키를 주지만 cancel/resolve 게이트는 `systemRole`을 직접 본다):

```ts
const u = session.user;                                   // SessionUser: { id, systemRole, ... }
const isOwner = u.systemRole === "OWNER";
const isAdmin = isOwner || u.systemRole === "ADMIN";
const summary = await getPermissionSummary(u.id);
const permissionKeys = new Set(summary.keys);
// TransitionCtx: { userId: u.id, isOwner, permissionKeys, note? }
// MailActionCtx: { userId: u.id, isOwner, isAdmin, permissionKeys }
```

- 에러→상태 매핑(라우트 공통 헬퍼): `ForbiddenError`→403, `ConflictError`→409, `ZodError`→400, 그 외 throw(500). `ForbiddenError`는 `@/kernel/access`, `ConflictError`는 `@/modules/workflows/types`.

### SC-9. API 라우트 (Task 09)

| 메서드·경로 | 동작 | 권한 |
| --- | --- | --- |
| `GET /api/workflows?status&start&end` | 목록(보유 kind만) | `<kind>:view` |
| `GET /api/workflows/[id]` | 상세 | 해당 kind `:view` |
| `POST /api/workflows` | 생성(`typeId`,`scheduledAt`) | `<kind>:create` |
| `POST /api/workflows/[id]/cancel` | CANCELLED 전이 | `:view` + 본인/admin |
| `POST /api/workflows/[id]/mail/[deliveryId]/retry` | FAILED 재시도 | 해당 kind `:send` |
| `POST /api/workflows/[id]/mail/[deliveryId]/resolve` | SENDING 수동 확정 | admin |

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 스키마 + migration (WorkflowTaskEvent·MailDelivery 보강) | [ ] | [task-01](2026-06-19-phase-4-workflows-core/task-01-schema-migration.md) | — | |
| 02 | policy·types·ConflictError (정책 데이터 + 포트) | [ ] | [task-02](2026-06-19-phase-4-workflows-core/task-02-policy-types.md) | — | |
| 03 | workflow-task repository (Prisma 직접) | [ ] | [task-03](2026-06-19-phase-4-workflows-core/task-03-task-repository.md) | 01,02 | |
| 04 | lifecycle 전이 엔진 (transition/create/cancel) | [ ] | [task-04](2026-06-19-phase-4-workflows-core/task-04-lifecycle.md) | 02,03 | |
| 05 | 메일 전송 lib (Nodemailer) + env | [ ] | [task-05](2026-06-19-phase-4-workflows-core/task-05-mail-lib.md) | — | |
| 06 | mail repository + service (deliver/retry/resolve) | [ ] | [task-06](2026-06-19-phase-4-workflows-core/task-06-mail-service.md) | 01,02,05 | |
| 07 | tasks read service + generator 헬퍼 | [ ] | [task-07](2026-06-19-phase-4-workflows-core/task-07-tasks-generator.md) | 02,03 | |
| 08 | 캘린더 CANCELLED 제외 보정 | [ ] | [task-08](2026-06-19-phase-4-workflows-core/task-08-calendar-cancelled.md) | — | |
| 09 | API 라우트 + zod 검증 (6개) | [ ] | [task-09](2026-06-19-phase-4-workflows-core/task-09-api-routes.md) | 04,06,07 | |
| 10 | seed-demo: WorkflowType 3종 + 샘플 task/event/mail | [ ] | [task-10](2026-06-19-phase-4-workflows-core/task-10-seed-demo.md) | 01 | |
| 11 | UI: 목록 + timeline shell ([id]) | [ ] | [task-11](2026-06-19-phase-4-workflows-core/task-11-ui.md) | 09 | |

## 공통 규칙

- TDD: 실패 테스트 → FAIL 확인 → 최소 구현 → PASS → commit. 태스크마다.
- 테스트는 node 환경(DB·외부 없이). Prisma는 `vi.mock("@/lib/prisma", …)` in-memory fake(`$transaction` 콜백 지원), 메일은 `setMailTransportForTests(fake)` 또는 `vi.mock("@/lib/integrations/mail")`.
- boundaries: `workflows` 모듈은 kernel·lib·자기 모듈만 import(타 모듈 금지). Prisma는 `workflows/repositories/`에서만. 메일 전송은 `lib/integrations/mail`.
- 게이트: 각 태스크 AC에 `npm run typecheck` / `npm run lint` / `npm test` 포함. 스키마 변경은 Task 01 migration 1건. UI 태스크는 `npm run build`도 포함.
- AI 서명 없는 commit(글로벌 규칙).
