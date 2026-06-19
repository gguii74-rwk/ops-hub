# Phase 4 — Workflows 공통 기반 설계

- Status: Draft (리뷰 대기)
- Date: 2026-06-19
- Roadmap: `docs/product/modernization-roadmap.md` Phase 4 (Workflows 포팅)
- Discovery: `docs/discovery/day-sync-analysis.md`
- 선행: Phase 3(통합 캘린더와 캐시) 머지 완료 — `calendar` 모듈이 `WorkflowTask`를 이미 출처로 읽는다.

## 1. 목표와 범위

day-sync 업무 자동화(~3,800줄)를 ops-hub로 포팅한다. day-sync는 3개 워크플로(주간보고·대금청구·알림톡)가 기술·복잡도·상태 전이 경로가 제각각이라 단일 스펙으로 담기 어렵다. 따라서 Phase 4를 **공통 기반 + 워크플로별 sub-project**로 분해하고, **이 스펙은 공통 기반(sub-project 1)만** 다룬다.

### 분해 구조

| sub-project | 내용 | 머지 단위 |
| --- | --- | --- |
| **1. 공통 기반 (이 스펙)** | lifecycle 도메인·전이 엔진·메일 인프라·이력·timeline UI shell·문서 생성 포트 | 독립 머지 |
| 2. 주간보고 | ExcelJS XLSX 생성기, Google Sheets 읽기, 생성·미리보기 UI | 후속 스펙 |
| 3. 대금청구 | HWPX 4종 생성기, BillingConfig 설정 UI | 후속 스펙 |
| 4. 알림톡 | HWPX/XLSX/PDF 복합 생성기, LibreOffice 변환, 선결제 분기 | 후속 스펙 |

각 sub-project는 자체 스펙 → `writing-plans-split` 계획 → 구현 → 머지 사이클을 가진다.

### 포함 (공통 기반)

- `WorkflowType`/`WorkflowTask` repository·service (조회·생성·상태 전이·취소)
- 선언적 전이 테이블을 주입받는 **상태 전이 검증·기록 엔진**
- `WorkflowTaskEvent` 이력 (timeline 단일 출처)
- `GeneratedFile` 기록 메커니즘, `MailDelivery` 이력(시도 결과·재시도)
- 메일 발송 인프라 (`lib/integrations/mail`, Nodemailer 포팅)
- **문서 생성 포트(interface)** — 워크플로가 구현할 계약만, 실제 생성 로직 없음
- 작업 목록 + 단계형 작업 상세 **timeline shell** UI
- 캘린더 노출 보정(CANCELLED 제외)

### 비포함 (후속 sub-project)

실제 문서 생성기(ExcelJS/HWPX/PDF), Google Sheets 데이터 읽기, LibreOffice PDF 변환, 워크플로별 생성·미리보기 화면, BillingConfig 설정 UI, generate/send 같은 부수효과 전이 라우트.

## 2. 설계 결정 요약

| # | 결정 | 근거 |
| --- | --- | --- |
| D1 | 공통 기반엔 **계약(port)만**, 생성기·Sheets·LibreOffice는 워크플로 sub-project | 공통 기반을 얇고 안정적으로. HWPX 취약성·Sheets 포맷 변동을 워크플로별로 격리 |
| D2 | 전이는 **선언적 전이 테이블 주입** + 단일 엔진 fail-closed 검증·기록 | day-sync의 워크플로별 분기 로직을 명시적 데이터로 정리. 검증 단일 출처 |
| D3 | 메일은 **동기 발송 + 시도이력·재시도** | 로드맵 "이력·재시도 가능" 원칙. 단일 프로세스 규모에 큐는 과임 |
| D4 | timeline 이력은 **`WorkflowTaskEvent` 전용 테이블** | 단계별 수행자·시각이 정확. 워크플로별 단계 증가에도 일관 |
| D5 | UI는 **목록 + timeline shell**, 생성/발송/미리보기는 slot | 단계형 timeline은 모든 워크플로 공통 자산. 워크플로별 화면은 격리 |

## 3. 모듈 구조와 경계

```
src/modules/workflows/
  policy.ts             # WorkflowKind별 TRANSITIONS 맵 + KIND_RESOURCE 권한 매핑(데이터)
  types.ts              # GeneratorPort, 공통 컨텍스트·DTO 타입
  repositories/index.ts # WorkflowType/Task/GeneratedFile/MailDelivery/WorkflowTaskEvent (Prisma 직접)
  services/
    lifecycle.ts        # transitionTask(검증·기록), createTask, cancelTask
    tasks.ts            # 목록·상세 조회(type+files+mail+events 조립)
    mail.ts             # 발송·재시도(이력 기록) — lib/integrations/mail 호출
  validations/index.ts  # zod 입력 스키마
src/lib/integrations/mail/  # Nodemailer 포팅 (lib — 모듈 경계 밖, 워크플로가 공유)
src/app/(app)/workflows/    # page(목록) + [id]/page(상세 timeline shell)
src/app/api/workflows/      # route handlers (목록/상세/생성/취소/메일재시도)
```

경계 규칙(eslint boundaries 유지):

- `workflows` 모듈은 `kernel`·`lib`·자기 모듈만 import. 타 도메인 모듈 금지.
- Prisma 접근은 `workflows/repositories`에서만.
- 메일은 `lib/integrations/mail`에 두어 워크플로 sub-project가 공유한다(모듈 import 금지 대상 아님).
- 문서 생성 포트(`GeneratorPort`)는 `workflows/types.ts`에 선언만. 구현체는 후속 sub-project가 자기 모듈에 둔다.

## 4. 데이터 모델 변경

migration 1건. 기존 `WorkflowType`/`WorkflowTask`/`GeneratedFile`/`BillingConfig`는 변경하지 않는다.

### 4.1 `WorkflowTaskEvent` 신설 (schema `workflows`)

```prisma
model WorkflowTaskEvent {
  id         String          @id @default(cuid())
  taskId     String
  task       WorkflowTask    @relation(fields: [taskId], references: [id], onDelete: Cascade)
  fromStatus WorkflowStatus?                 // 최초 생성 이벤트는 null
  toStatus   WorkflowStatus
  actorId    String?                         // 수행자(시스템 자동은 null)
  note       String?
  occurredAt DateTime        @default(now())

  @@index([taskId, occurredAt])
  @@schema("workflows")
}
```

`WorkflowTask`에 역관계 `events WorkflowTaskEvent[]` 추가.

### 4.2 `MailDelivery` 보강

```prisma
enum MailDeliveryStatus {
  SENT
  FAILED

  @@schema("workflows")
}
```

`MailDelivery`에 추가:

- `status MailDeliveryStatus`
- `errorMessage String?`
- `sentAt`을 nullable로 변경 (`DateTime?`, FAILED면 null). 기본값 `@default(now())` 제거.

기존 `step`/`recipients`/`subject`/`attachmentPaths`/`providerMessageId`/`sentById`는 유지.

### 4.3 기존 타임스탬프 컬럼 처리

`WorkflowTask.generatedAt`/`reviewedAt`/`sentAt`은 **제거하지 않는다**(파괴적 migration 회피, 빠른 조회용). 전이 엔진은 `toStatus`에 대응하는 컬럼이 있으면 함께 stamp한다(`GENERATED→generatedAt`, `REVIEWED→reviewedAt`, `SENT→sentAt`). timeline 렌더의 정식 출처는 `WorkflowTaskEvent`다.

## 5. 전이 엔진

### 5.1 정책 데이터 (`policy.ts`)

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

// 권한 검사용 리소스 매핑. 액션은 전이 대상별로 결정(아래 ACTION_FOR_STATUS).
export const KIND_RESOURCE: Record<WorkflowKind, string> = {
  WEEKLY_REPORT: "workflows.weekly",
  BILLING: "workflows.billing",
  NOTIFICATION_BILLING: "workflows.notification",
};

// 전이 대상 → 요구 권한 액션. (catalog ACTIONS 중)
export const ACTION_FOR_STATUS: Partial<Record<WorkflowStatus, string>> = {
  GENERATED: "generate",
  REVIEWED: "review",
  SENT: "send",
  HQ_REQUESTED: "send",
  FINAL_SENT: "send",
  CANCELLED: "view",   // 취소는 별도 소유자/admin 규칙으로 추가 게이트(아래)
};
```

> 주: 정책 데이터는 모든 워크플로 종류를 한 파일에 둔다(공통 기반이 전이 검증을 소유하므로). 워크플로 sub-project는 부수효과(생성·발송) orchestration만 추가하고 정책을 재정의하지 않는다. 후속 sub-project에서 누락 액션(`workflows.billing:generate` 등)은 `seed-permissions.ts`의 `EXTRA_PERMISSIONS`에 추가한다.

### 5.2 엔진 (`services/lifecycle.ts`)

```ts
export interface TransitionCtx {
  userId: string;
  isOwner: boolean;
  permissionKeys: Set<string>;   // getPermissionSummary().keys
  note?: string;
}

// fail-closed: 정책에 없는 전이·권한 없는 전이는 throw.
export async function transitionTask(taskId: string, to: WorkflowStatus, ctx: TransitionCtx): Promise<void>;
export async function createTask(input: { typeId: string; scheduledAt: Date }, ctx: TransitionCtx): Promise<WorkflowTask>;
export async function cancelTask(taskId: string, ctx: TransitionCtx): Promise<void>;
```

`transitionTask` 절차:

1. task 조회(없으면 throw). `kind = task.type.kind`.
2. `allowed = TRANSITIONS[kind][task.status] ?? []`. `to ∉ allowed` → throw(거부).
3. 권한: `action = ACTION_FOR_STATUS[to]`. `OWNER` 허용, 아니면 `permissionKeys.has(`${KIND_RESOURCE[kind]}:${action}`)` 필요. 없으면 throw.
4. `to === CANCELLED`이면 추가 게이트: 본인(`task.createdById === userId`) 또는 OWNER만.
5. 트랜잭션:
   - `WorkflowTask.status = to`, 대응 타임스탬프 컬럼 stamp(있으면).
   - `WorkflowTaskEvent` insert(`fromStatus`, `toStatus`, `actorId=userId`, `note`).

권한 우선순위는 access-control 규칙(OWNER 허용 → 기본 거부)을 따른다. 부수효과 없는 순수 전이는 `cancelTask`만 API로 노출(§9). generate/send는 워크플로 sub-project가 생성·발송 성공 후 `transitionTask`를 호출한다.

## 6. 메일 인프라

### 6.1 `lib/integrations/mail`

day-sync `email-sender.ts` 포팅. SMTP 설정은 env(`SMTP_HOST/PORT/SECURE/USER/PASS/FROM`). 첨부·수신자 정규화, HTML 서명. 순수 전송 책임만(이력 기록 없음).

```ts
export interface MailMessage { to: string[]; subject: string; html: string; attachments?: MailAttachment[]; }
export async function sendMail(msg: MailMessage): Promise<{ providerMessageId: string | null }>;
```

### 6.2 `services/mail.ts`

```ts
// 동기 발송 후 결과를 MailDelivery에 기록(성공/실패 모두).
export async function deliver(args: { taskId: string | null; step: string | null; msg: MailMessage; sentById: string }): Promise<MailDelivery>;
// FAILED 레코드 재처리(같은 수신자·첨부로 재발송, 결과 갱신 또는 새 레코드).
export async function retryDelivery(deliveryId: string, ctx: { userId: string }): Promise<MailDelivery>;
```

- 성공: `status=SENT`, `sentAt=now`, `providerMessageId`.
- 실패: `status=FAILED`, `errorMessage`, `sentAt=null`. **워크플로 상태 전이와 분리** — 발송 실패가 직전 전이를 롤백하지 않는다(워크플로 service가 발송 단계를 분리해 호출).
- 재시도는 `failed` 레코드를 다시 발송. 결과는 기존 레코드를 갱신한다(이력 단순화). attemptCount는 두지 않는다(YAGNI; 필요 시 후속).

## 7. 권한·네비게이션

- 권한 키는 기존 `catalog.ts`(`RESOURCES`/`ACTIONS`)·`seed-permissions.ts`를 활용한다. 공통 기반은 신규 리소스를 만들지 않는다.
- 공통 기반이 사용하는 키: 목록·상세=`workflows.<kind>:view`, 생성=`workflows.<kind>:create`, 취소=`workflows.<kind>:view` + 본인/admin 게이트(§5.2).
- 전이 액션 키(`:generate`/`:review`/`:send`)는 정책이 참조하되, 누락분은 해당 워크플로 sub-project가 `EXTRA_PERMISSIONS`에 추가한다. 공통 기반은 `weekly`에 이미 있는 `generate`/`send`로 엔진·테스트를 검증한다.
- NAV `/workflows`(`workflows.weekly:view`)는 이미 시드됨 — 변경 없음.
- UI `useCan(...)`와 서버 `requirePermission(...)`이 동일 키를 공유한다(access-control 규칙 1).

## 8. 캘린더 연동

- `WorkflowTask` 생성 시 `calendar`의 work/team/admin 뷰에 자동 노출된다(`workflowTaskProvider` → `findWorkflowTasksInRange`).
- 현재 `findWorkflowTasksInRange`는 status 필터가 없어 `CANCELLED` 작업도 노출된다. 공통 기반에서 **CANCELLED 제외** 보정을 추가한다(calendar repository). 회귀 테스트 포함.
- 이 보정은 `calendar` 모듈 내 변경이지만 Phase 4 공통 기반 작업으로 둔다(WorkflowTask lifecycle 도입의 직접 결과).

## 9. API 계약

모든 라우트는 인증 필수, permission 검사는 UI와 동일 키.

| 메서드·경로 | 동작 | 권한 |
| --- | --- | --- |
| `GET /api/workflows?status&start&end` | 작업 목록 | `workflows.<kind>:view`(보유 kind만) |
| `GET /api/workflows/[id]` | 상세(type+files+mailDeliveries+events) | 해당 kind `:view` |
| `POST /api/workflows` | 작업 생성(`typeId`, `scheduledAt`) | `workflows.<kind>:create` |
| `POST /api/workflows/[id]/cancel` | `CANCELLED` 전이 | `:view` + 본인/admin |
| `POST /api/workflows/[id]/mail/[deliveryId]/retry` | FAILED 메일 재시도 | 해당 kind `:send` |

- generate/send 부수효과 라우트는 **공통 기반에 없다**. 워크플로 sub-project가 추가한다.
- 입력 검증은 zod(`validations/`). 범위 파라미터는 calendar와 동일하게 KST·반열림 규약 재사용 가능.

## 10. UI

- `/workflows` 목록: WorkflowTask 행(제목·종류·예정일·상태 배지), status 필터. 권한 있는 kind만 노출.
- `/workflows/[id]` 상세:
  - **timeline**: `WorkflowTaskEvent` 기반 단계별(수행자·시각·from→to·note) + 각 단계의 `GeneratedFile`·`MailDelivery`(성공/실패 배지·오류) 연결 표시.
  - 액션: **취소**, **메일 재시도** 버튼(공통). **생성/발송/미리보기 버튼은 slot**(후속 워크플로 sub-project가 채움).
- React Query로 목록·상세 조회(Phase 3 패턴 재사용), 기존 ui 프리미티브·테마 사용.
- seed에 더미 `WorkflowType` 3종 + 샘플 `WorkflowTask`/`WorkflowTaskEvent`로 shell을 시연·테스트 가능하게 한다.

## 11. 문서 생성 포트

```ts
// types.ts — 계약만. 구현체는 후속 sub-project가 자기 모듈에 둔다.
export interface GeneratorResult { files: Array<{ path: string; displayName: string; mimeType?: string; sizeBytes?: number }>; }
export interface GeneratorPort {
  kind: WorkflowKind;
  generate(task: WorkflowTask): Promise<GeneratorResult>;
}
```

공통 기반은 `GeneratorResult.files`를 `GeneratedFile`로 기록하는 헬퍼만 제공한다(`recordGeneratedFiles(taskId, result)`). 실제 `generate` 구현·등록은 워크플로 sub-project가 한다.

## 12. 테스트 전략

TDD(실패 테스트 → FAIL 확인 → 최소 구현 → PASS → commit). node 환경, DB·외부 없이.

- 전이 엔진: 허용 전이 통과 / 비허용 거부(fail-closed) / 권한 없는 전이 거부 / OWNER 우회 / 취소 본인·admin 게이트 / 타임스탬프 stamp / 이벤트 기록.
- 메일: SENT 기록 / FAILED+error 기록 / sentAt null on fail / 재시도가 결과 갱신 / 발송 실패가 전이 롤백 안 함.
- repository: 목록·상세 조립, CANCELLED 캘린더 제외 회귀(calendar source 경유).
- 라우트: 인증·권한(보유 kind만 노출, fail-closed), zod 검증.
- Prisma는 `vi.mock("@/lib/prisma")` in-memory fake, 메일은 fake transport 주입.

게이트(각 태스크 AC): `npm run typecheck` / `npm run lint` / `npm test` / `npm run build`. 스키마 변경은 §4 migration 1건.

## 13. 미해결·후속

- 워크플로별 누락 권한 액션(`workflows.billing:generate`, `workflows.notification:generate`/`review`/`configure` 등)은 해당 sub-project가 `EXTRA_PERMISSIONS`에 추가한다.
- 메일 재시도 횟수·백오프, 첨부 대용량 처리(25MB)는 발송을 실제로 쓰는 워크플로 sub-project에서 구체화한다.
- AI 서명 없는 commit(글로벌 규칙).
