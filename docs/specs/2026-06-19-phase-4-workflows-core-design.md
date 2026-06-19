# Phase 4 — Workflows 공통 기반 설계

- Status: Draft (Codex 적대 리뷰 3회 반영 — 원자 전이·retry authz·발송 멱등·본문 보존·SENDING 운영자 해소)
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
  SENDING   // 발송 전 생성. SMTP 성공 후 갱신이 실패해도 "유령 발송"을 탐지할 수 있게 남는 중간 상태
  SENT
  FAILED

  @@schema("workflows")
}
```

`MailDelivery`에 추가:

- `status MailDeliveryStatus`
- `errorMessage String?`
- `bodyHtml String?` — 렌더된 발송 본문. retry가 워크플로 재생성 없이 원본을 그대로 재발송하도록 보존한다(§6.2). 첨부는 기존 `attachmentPaths`(shared storage 경로)로 이미 보존된다.
- `sentAt`을 nullable로 변경 (`DateTime?`, SENDING/FAILED면 null). 기본값 `@default(now())` 제거.

기존 `step`/`recipients`/`subject`/`attachmentPaths`/`providerMessageId`/`sentById`는 유지.

**발송 멱등성 인덱스**: 같은 논리적 발송의 중복 SMTP를 막기 위해 `(taskId, step)`에 **부분 unique 인덱스**를 둔다 — `WHERE taskId IS NOT NULL AND status IN ('SENDING','SENT')`. FAILED·임시 메일(taskId null)은 제외해 재시도 갱신·비워크플로 발송과 충돌하지 않는다. Prisma가 partial unique index를 직접 표현하지 못하므로 migration raw SQL로 추가하고, 애플리케이션도 tx 내에서 동일 가드를 둔다(§6.2).

**migration 안전성**: `MailDelivery`는 main에 **이미 존재하던 테이블**이다(day-sync 계승). `src/`·seed가 cutover 전이라 행이 없을 것으로 기대하지만, 스키마가 행을 허용하므로 비어있음을 전제로 삼지 않는다. main의 기존 행은 `sentAt`이 NOT NULL(`@default(now())`)인 **완료된 발송**이므로, migration은 `status`에 임시 default `SENT`를 부여해 컬럼을 추가한 뒤 default를 제거하는 2단 SQL로 작성한다 — 기존 행은 `SENT`로 backfill되고, 신규 앱 insert는 항상 명시적 status를 준다. 임시 default를 `SENDING`으로 두면 과거 발송이 진행 중으로 둔갑해 cancel 게이트(`hasActiveSending`)·활성 unique 인덱스를 막으므로 금지한다. 부분 unique 인덱스도 같은 migration의 raw SQL로 추가한다(같은 `(taskId, step)`로 2건 이상 발송된 레거시 데이터가 cutover로 유입되면 인덱스 생성이 실패할 수 있어, cutover ETL에서 dedup이 필요하다 — 이 migration의 책임 범위는 아니다).

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

1. task 조회(없으면 throw). `kind = task.type.kind`, `fromStatus = task.status`.
2. `allowed = TRANSITIONS[kind][fromStatus] ?? []`. `to ∉ allowed` → throw(거부).
3. 권한: `action = ACTION_FOR_STATUS[to]`. `OWNER` 허용, 아니면 `permissionKeys.has(`${KIND_RESOURCE[kind]}:${action}`)` 필요. 없으면 throw.
4. `to === CANCELLED`이면 추가 게이트: 본인(`task.createdById === userId`) 또는 OWNER만. 또한 해당 task에 활성(SENDING) `MailDelivery`가 있으면 `ConflictError` — 발송 진행 중 취소를 막아 "SMTP 성공인데 CANCELLED"라는 lifecycle 불일치를 차단한다(§6.3).
5. 트랜잭션(조건부·원자):
   - `updateMany({ where: { id: taskId, status: fromStatus }, data: { status: to, …대응 타임스탬프 } })`.
   - **갱신 행 수가 0이면** 그 사이 상태가 바뀐 것 → `ConflictError`(API는 409). read-then-write의 last-write-wins와 이중 이벤트 기록을 막는다.
   - 1행 갱신에 성공한 경우에만 `WorkflowTaskEvent` insert(`fromStatus`, `toStatus`, `actorId=userId`, `note`).

이 조건부 업데이트 패턴은 `kernel/settings/repository.ts`의 낙관적 동시성(`updateMany` + 기대값 일치) 관례를 따른다. 권한 우선순위는 access-control 규칙(OWNER 허용 → 기본 거부)을 따른다. 부수효과 없는 순수 전이는 `cancelTask`만 API로 노출(§9). generate/send는 워크플로 sub-project가 생성·발송 성공 후 `transitionTask`를 호출한다.

## 6. 메일 인프라

### 6.1 `lib/integrations/mail`

day-sync `email-sender.ts` 포팅. SMTP 설정은 env(`SMTP_HOST/PORT/SECURE/USER/PASS/FROM`). 첨부·수신자 정규화, HTML 서명. 순수 전송 책임만(이력 기록 없음).

```ts
export interface MailMessage { to: string[]; subject: string; html: string; attachments?: MailAttachment[]; }
export async function sendMail(msg: MailMessage): Promise<{ providerMessageId: string | null }>;
```

### 6.2 `services/mail.ts`

```ts
// 발송 전 SENDING 레코드 생성 → SMTP → 정확히 1회 SENT/FAILED로 갱신.
export async function deliver(args: { taskId: string | null; step: string | null; msg: MailMessage; sentById: string }): Promise<MailDelivery>;
// FAILED 레코드 재처리. taskId·authz ctx로 소속·권한을 검증한 뒤 재발송.
export async function retryDelivery(
  args: { deliveryId: string; taskId: string },
  ctx: { userId: string; isOwner: boolean; permissionKeys: Set<string> },
): Promise<MailDelivery>;
```

발송 절차(`deliver`):

1. **멱등 가드(tx)**: `taskId != null && step != null`이면 같은 `(taskId, step)`에 활성(SENDING/SENT) 레코드가 있는지 확인한다. 있으면 새 SMTP 없이 **`ConflictError`(409)** — 더블클릭·요청 타임아웃 후 브라우저/서버 재시도로 인한 중복 외부 발송을 막는다.
2. **발송 전** `status=SENDING`, `sentAt=null`, `bodyHtml=msg.html`, `recipients`/`subject`/`attachmentPaths` 레코드 생성. `(taskId, step)` 부분 unique 인덱스(§4.2)가 경합 시 최종 방어선.
3. SMTP 전송.
4. 결과로 같은 레코드를 **정확히 1회** 갱신 — 성공: `status=SENT`, `sentAt=now`, `providerMessageId`. 실패: `status=FAILED`, `errorMessage`.

- 2단계가 있어 SMTP 성공 후 4단계 갱신이 실패한 "유령 발송"도 `SENDING` 레코드로 남아 운영자가 탐지·판단할 수 있다.
- **워크플로 상태 전이와 분리** — 발송 실패가 직전 전이를 롤백하지 않는다(워크플로 service가 발송 단계를 분리해 호출).

재시도(`retryDelivery`)는 **저장된 `bodyHtml`·`recipients`·`subject`·`attachmentPaths`로 원본을 그대로 재발송**한다(워크플로 재생성 없음 → 본문 drift 없음). 기존 레코드를 제자리 갱신하므로(새 행 없음) deliver의 `(taskId, step)` 부분 unique 인덱스(§4.2)는 retry 경합을 막지 못한다 — 같은 행을 두 번 UPDATE할 뿐이라 P2002가 나지 않는다. 따라서 retry는 **자체 원자 점유**로 단일 비행을 보장한다(attemptCount는 두지 않음 — YAGNI). fail-closed로 다음을 검증·점유한 뒤 발송하고 기존 레코드를 갱신한다:

- (a) `delivery.taskId === args.taskId` (route task 소속 확인)
- (b) `delivery.status === FAILED` (SENDING은 발송 여부가 불확실하므로 자동 재시도하지 않고 UI에 '확인 필요'로 표시 — 중복 발송 방지)
- (c) `ctx.isOwner` 또는 `ctx.permissionKeys.has(`${KIND_RESOURCE[kind]}:send`)` (kind는 delivery→task→type에서 로드). 한 워크플로 도메인의 `:send` 권한으로 타 도메인 발송을 재전송하는 것을 막는다.
- (d) **원자 점유**: `FAILED→SENDING`을 조건부 `updateMany({ id, taskId, status: FAILED })`로 1회 갱신. 갱신 0건이면(동시 재시도가 이미 점유) **`ConflictError`(409)** — SMTP 미발생. 점유 성공 후 비로소 발송하므로 동시 retry 중 정확히 1건만 외부 발송한다. 점유 직후 행은 `SENDING`이라 cancel 게이트(`hasActiveSending`, §5.2)와 멱등 가드(§6.2)에도 진행 중으로 가시화된다.
- 첨부 파일이 shared storage에서 사라졌으면 재발송은 (점유 후) FAILED로 처리한다(조용한 실패 금지).

### 6.3 send orchestration 계약과 SENDING 해소

SMTP는 비가역이고 DB 트랜잭션과 원자적으로 묶을 수 없다. 공통 기반은 이를 자동 보상기 없이 **순서 계약 + 운영자 해소**로 다룬다(워크플로 sub-project가 따른다).

**발송 순서 계약:**

1. 발송 가능 확인 — 현재 status가 전이 허용 상태이고, 해당 task에 활성 SENDING이 없을 것.
2. `deliver()` — SMTP, `MailDelivery`를 SENT/FAILED로 확정.
3. SENT면 `transitionTask(SENT)`.

2와 3 사이 실패(동시 cancel·conflict·DB 오류)는 "`MailDelivery=SENT`인데 task는 발송 전 상태"라는 불일치를 남길 수 있다. 이 불일치는 **자동 보상하지 않고 timeline에 드러내**, 운영자가 `transitionTask`를 재호출(멱등 — `fromStatus` 조건부라 같은 전이는 1회만 성공)해 해소한다.

**SENDING 해소(admin):** 크래시·타임아웃으로 최종 상태에 도달하지 못한 SENDING 잔여 레코드는, foundation이 멱등 가드(`(taskId, step)` 부분 unique 인덱스)를 소유하므로 **해소 경로도 foundation이 제공**한다. admin이 SMTP 실제 발송 여부를 조사한 뒤 SENT/FAILED를 **수동 확정**한다 — FAILED로 확정하면 `(taskId, step)` 활성 유일성이 풀려 재발송이 가능해진다. 발송 여부 오판→중복 SMTP를 막기 위해 **자동 timeout 전환은 두지 않는다**(오래된 SENDING은 UI에 경고만 표시).

```ts
// admin 전용. SENDING 레코드만 대상. SENT/FAILED로 확정해 멱등 가드를 해제·종료.
export async function resolveDelivery(
  args: { deliveryId: string; taskId: string; to: "SENT" | "FAILED" },
  ctx: { userId: string; isOwner: boolean; permissionKeys: Set<string> },
): Promise<MailDelivery>;
```

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
| `POST /api/workflows/[id]/mail/[deliveryId]/resolve` | SENDING 잔여 수동 확정(SENT/FAILED) | admin(OWNER/ADMIN) |

- 전이(취소 포함)는 조건부 업데이트라 경쟁 시 한쪽만 성공하고 진 쪽은 **409 Conflict**를 받는다(§5.2).
- `retry`는 `delivery.taskId === [id]`(소속) && `delivery.status === FAILED`(상태)를 검증하고, 권한은 해당 task kind의 `:send`로 검사한다. `SENDING`(발송 불확실)은 재시도 불가 — UI에서 '확인 필요'로만 노출(§6.2, §10).
- 활성 SENDING 발송이 있는 task의 `cancel`은 **409**로 거부된다(발송 진행 중 취소 차단, §5.2). `resolve`는 admin만 호출하며 SENDING 잔여를 SENT/FAILED로 확정해 멱등 가드를 해제한다(§6.3).
- generate/send 부수효과 라우트는 **공통 기반에 없다**. 워크플로 sub-project가 추가한다. 단 그 라우트가 호출하는 `deliver()`는 공통 기반이 제공하며 `(taskId, step)` 멱등이다 — 중복 호출은 **409**(§6.2).
- 입력 검증은 zod(`validations/`). 범위 파라미터는 calendar와 동일하게 KST·반열림 규약 재사용 가능.

## 10. UI

- `/workflows` 목록: WorkflowTask 행(제목·종류·예정일·상태 배지), status 필터. 권한 있는 kind만 노출.
- `/workflows/[id]` 상세:
  - **timeline**: `WorkflowTaskEvent` 기반 단계별(수행자·시각·from→to·note) + 각 단계의 `GeneratedFile`·`MailDelivery`(SENT/FAILED/SENDING='확인 필요' 배지·오류) 연결 표시.
  - 액션: **취소**, **메일 재시도** 버튼(공통). 재시도는 `FAILED` 메일에만 노출. `SENDING`은 '확인 필요'로 표시하고, **admin에게만 SENT/FAILED 확정(resolve) 액션**을 노출한다(오래 머문 SENDING은 경고 강조). post-SMTP 전이 실패로 생긴 불일치(메일 SENT·task 미전이)는 timeline에 드러나며 운영자가 전이를 재시도해 해소한다. **생성/발송/미리보기 버튼은 slot**(후속 워크플로 sub-project가 채움).
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

- 전이 엔진: 허용 전이 통과 / 비허용 거부(fail-closed) / 권한 없는 전이 거부 / OWNER 우회 / 취소 본인·admin 게이트 / 타임스탬프 stamp / 이벤트 기록 / **경쟁 전이 동시성**(조건부 `updateMany`가 0행이면 ConflictError, 이벤트는 1건만 기록).
- 메일: SENDING 선기록 → SENT 갱신 / SENDING → FAILED+error 갱신 / sentAt null(SENDING·FAILED) / 발송 실패가 전이 롤백 안 함.
- 메일 멱등: 같은 `(taskId, step)` deliver 중복 호출 → 두 번째는 ConflictError(409), SMTP 1회·활성 레코드 1개 / `taskId` 또는 `step`이 null이면 멱등 미적용 / FAILED 레코드가 있으면 deliver는 새 발송 허용(재시도와 구분).
- 메일 재시도 authz·본문: FAILED만 재시도 / `delivery.taskId` 불일치 거부 / 타 kind `:send`로 거부 / SENDING 재시도 거부 / 저장된 `bodyHtml`로 재발송(워크플로 재생성 없음) / 첨부 유실 시 FAILED / 성공 시 기존 레코드 갱신.
- 발송 신뢰성·해소: 활성 SENDING 있는 task의 cancel 거부(409) / admin `resolve`가 SENDING→FAILED로 `(taskId, step)` 유일성 해제 후 재발송 허용 / `resolve` SENDING→SENT 확정 / 비-admin `resolve` 거부 / SENDING 아닌 레코드 `resolve` 거부 / post-SMTP 전이 실패 후 `transitionTask` 재호출로 해소(멱등, 이벤트 1건).
- repository: 목록·상세 조립, CANCELLED 캘린더 제외 회귀(calendar source 경유).
- 라우트: 인증·권한(보유 kind만 노출, fail-closed), zod 검증.
- Prisma는 `vi.mock("@/lib/prisma")` in-memory fake, 메일은 fake transport 주입.

게이트(각 태스크 AC): `npm run typecheck` / `npm run lint` / `npm test` / `npm run build`. 스키마 변경은 §4 migration 1건.

## 13. 비목표·후속

### 비목표 (명시적)

- **durable outbox·백그라운드 발송 워커·메시지 큐는 도입하지 않는다**(단일 프로세스·소규모 내부 팀, 결정 D3). 발송은 동기로 하고, 신뢰성은 `SENDING → SENT/FAILED` 단일-갱신 패턴(§6.2)과 수동 재시도로 확보한다.
- **자동 보상기(compensator)·SENDING 자동 timeout 전환·saga 오케스트레이션은 두지 않는다.** SMTP는 비가역이라 SMTP 후 DB 실패·SENDING 잔여는 **운영자 해소**(admin `resolve` + `transitionTask` 재호출, §6.3)로 복구한다 — 단일 프로세스·소규모 팀에서 자동 분산 복구는 과임이고, 발송 여부 오판 시 오히려 중복 SMTP를 유발한다. SENDING 해소·발송 중 취소 차단은 **공통 기반이 소유**한다(멱등 가드를 소유하는 계층이 해제도 소유).
- **발송 중복방지는 공통 기반의 책임이다.** `(taskId, step)` 단위 중복 SMTP는 `deliver()`의 멱등 가드(활성 레코드 유일성 + 부분 unique 인덱스, §4.2·§6.2)가 foundation에서 막는다 — 각 워크플로가 가드를 재구현하다 빠뜨려 고객 대면 메일(인보이스 등)이 중복 발송되는 fail-open을 차단한다. 공통 기반은 `transitionTask`(조건부·원자, §5.2)와 `deliver()`(멱등·발송전 레코드→1회 갱신, §6.2)의 원자성을 보장한다.
- **워크플로 sub-project 책임**: 어떤 step을 언제·어떤 순서로 보낼지(다단계 발송 orchestration)와 본문 재생성 정책. 발송 자체의 멱등·이력·재시도는 공통 기반이 담당한다.

### 후속

- 워크플로별 누락 권한 액션(`workflows.billing:generate`, `workflows.notification:generate`/`review`/`configure` 등)은 해당 sub-project가 `EXTRA_PERMISSIONS`에 추가한다.
- 메일 재시도 횟수·백오프, 첨부 대용량 처리(25MB)는 발송을 실제로 쓰는 워크플로 sub-project에서 구체화한다. (`SENDING` 잔여 해소는 §6.3에서 공통 기반이 담당한다.)
- AI 서명 없는 commit(글로벌 규칙).
