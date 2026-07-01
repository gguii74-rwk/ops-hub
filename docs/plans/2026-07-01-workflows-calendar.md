# 업무(Workflows) 캘린더 화면 — 구현 계획 (엔트리포인트)

- Feature: `/workflows` 단순 목록 → **연차와 동일한 월 캘린더**(`CalendarMonth` 재사용)로 교체 + kind별 색·단일선택 필터·날짜 팝오버·**생성 모달 일반화(5종 예약, 수준 B)** + 신규 client kind 2종 스캐폴딩.
- Goal: 업무를 월 캘린더로 보고, 권한 있는 유형을 클릭한 날짜로 예약(PENDING) 등록할 수 있다. 표현계층 + additive 스키마(신규 enum·타입·권한·nav)만 추가하고 기존 상태머신·BILLING 경로는 불변.
- Architecture: Route Handler → Service → Repository → Prisma. 캘린더 UI는 `CalendarMonth`(module)만 소비(module→ui 금지 유지). 신규 조회는 **전용 `GET /api/workflows/calendar`**(서버가 range 강제) + `getCalendarTasks` 서비스. 신규 kind는 enum·`WorkflowType`·권한·전이 정책으로 실제 스캐폴딩(UI 플레이스홀더 아님).
- Tech Stack: Next.js App Router, Prisma(PostgreSQL, multiSchema), React Query, vitest + testing-library, zod.
- Spec(SSOT): `docs/specs/2026-07-01-workflows-calendar-design.md`(D1~D13, 적대검증 ledger 5R). 이 plan은 spec의 DEFERRED_TO_IMPL 2건을 확정한다(§Shared Contracts 참조).

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-07-01-workflows-calendar/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts (2+ 태스크가 참조 — 여기 1회만 정의)

### SC-1. 신규 kind enum (schema.prisma `workflows` 스키마)

`WorkflowKind`에 **additive** 2값 추가(기존 3값 뒤). 마이그레이션 = `prisma/migrations/20260701000000_workflow_client_kinds/migration.sql`:

```prisma
enum WorkflowKind {
  WEEKLY_REPORT
  BILLING
  NOTIFICATION_BILLING
  WEEKLY_REPORT_CLIENT
  MONTHLY_REPORT_CLIENT

  @@schema("workflows")
}
```

```sql
-- migration.sql (additive enum — forward-safe. AlterEnum)
ALTER TYPE "workflows"."WorkflowKind" ADD VALUE 'WEEKLY_REPORT_CLIENT';
ALTER TYPE "workflows"."WorkflowKind" ADD VALUE 'MONTHLY_REPORT_CLIENT';
```

`WorkflowKind` = `"WEEKLY_REPORT" | "BILLING" | "NOTIFICATION_BILLING" | "WEEKLY_REPORT_CLIENT" | "MONTHLY_REPORT_CLIENT"`.

### SC-2. 정책 (`src/modules/workflows/policy.ts`) — 완전매핑 Record(typecheck 강제)

`KIND_RESOURCE`·`TRANSITIONS`는 `Record<WorkflowKind, …>`라 신규 kind 누락 시 typecheck 실패(D1).

```ts
export const KIND_RESOURCE: Record<WorkflowKind, string> = {
  WEEKLY_REPORT: "workflows.weekly",
  BILLING: "workflows.billing",
  NOTIFICATION_BILLING: "workflows.notification",
  WEEKLY_REPORT_CLIENT: "workflows.weeklyClient",
  MONTHLY_REPORT_CLIENT: "workflows.monthlyClient",
};
// 신규 2종 전이 = WEEKLY_REPORT 골격 재사용(D2). 생성기 없어 실질 동작은 예약(PENDING)+취소.
TRANSITIONS.WEEKLY_REPORT_CLIENT  = { PENDING: ["GENERATED", "CANCELLED"], GENERATED: ["SENT", "CANCELLED"] };
TRANSITIONS.MONTHLY_REPORT_CLIENT = { PENDING: ["GENERATED", "CANCELLED"], GENERATED: ["SENT", "CANCELLED"] };
```

### SC-3. 조회 allow-list 단일 출처 (F1 — typecheck 미보호 배열 제거)

`ALL_KINDS`(`services/tasks.ts`)와 page `KINDS`(`app/(app)/workflows/page.tsx`)를 **enum-파생**으로 대체:

```ts
const ALL_KINDS = Object.keys(KIND_RESOURCE) as WorkflowKind[]; // 완전매핑 Record → 신규 kind 자동 포함
```

### SC-4. 생성 계약 (기존 불변 — billing-ui D12)

`createTaskSchema`(`validations/index.ts`)의 `WORKFLOW_KINDS`를 5값으로 확장(enum 전체 수용):

```ts
const WORKFLOW_KINDS = ["WEEKLY_REPORT", "BILLING", "NOTIFICATION_BILLING", "WEEKLY_REPORT_CLIENT", "MONTHLY_REPORT_CLIENT"] as const;
```

`POST /api/workflows { kind, scheduledAt }` 라우트·`createTask` 서비스는 **변경 없음**. 생성 게이트 = per-kind `<kind>:create` 단일 관문(UI `useCan` + 서버 `createTask` 동일 키). 별도 allow-list 없음(수준 B — 5종 모두 예약 가능).

### SC-5. 라벨·표시 순서 (`src/app/(app)/workflows/labels.ts`)

```ts
// KIND_LABEL: 5종 사용자 명칭 통일(enum 값 불변, 라벨만). 상세/배지 등 소비처 자동 반영.
export const KIND_LABEL: Record<string, string> = {
  WEEKLY_REPORT: "주간보고(본부)",
  BILLING: "대금청구",
  NOTIFICATION_BILLING: "알림톡청구",
  WEEKLY_REPORT_CLIENT: "주간보고(고객사)",
  MONTHLY_REPORT_CLIENT: "월간보고(고객사)",
};
// 필터(전체+5)·드롭다운 공통 순서(D6/D10). 값=WorkflowKind.
export const WORKFLOW_KIND_ORDER: WorkflowKind[] =
  ["BILLING", "NOTIFICATION_BILLING", "WEEKLY_REPORT", "WEEKLY_REPORT_CLIENT", "MONTHLY_REPORT_CLIENT"];
```

### SC-6. kind별 색 (`src/modules/calendar/ui/kind-styles.ts`) — additive(D7)

`KIND_STYLES`에 5개 키 추가(키=`WorkflowKind` 문자열). 통합 캘린더의 `WORKFLOW_TASK`(단일 주황)와 **별개**(충돌 없음 — 별도 어댑터·별도 kind 키).

| kind | 색 | soft/bold Tailwind(기존 팔레트 계승) |
| --- | --- | --- |
| `BILLING` | 주황 | `orange-*`(기존 `WORKFLOW_TASK`와 동일 계열) |
| `NOTIFICATION_BILLING` | 청록 | `cyan-*` |
| `WEEKLY_REPORT` | 인디고 | `indigo-*` |
| `WEEKLY_REPORT_CLIENT` | 보라 | `violet-*` |
| `MONTHLY_REPORT_CLIENT` | 핑크 | `pink-*` |

### SC-7. 캘린더 이벤트 모델 (`src/modules/calendar/ui/event-input.ts` — 기존, 재정의 금지)

`CalendarEventInput { id; title; kind: string; start: string(ISO,포함); end?: string(ISO,제외); status?: EventStatus | null }`. half-open [start,end)(D14). `EventStatus = "PENDING"|"APPROVED"|"REJECTED"|"CANCELLED"`.

### SC-8. 어댑터 (`src/app/(app)/workflows/workflow-calendar-adapter.ts` — 신규 순수함수)

```ts
export interface WorkflowCalendarItem { id: string; kind: WorkflowKind; typeName: string; scheduledAt: string; status: WorkflowStatus; }
// 단일일(예정일) 이벤트. kind=WorkflowKind(색), title=KIND_LABEL, status=CANCELLED만 오버레이(D8: PENDING 등은 kind색 유지).
export function toCalendarEvent(item: WorkflowCalendarItem): CalendarEventInput;
```

`allDayHalfOpen(new Date(scheduledAt), new Date(scheduledAt))`로 KST 단일일 [dayStart,+1일) 산출(holidaysToEvents와 동일 패턴). status 매핑: `CANCELLED → "CANCELLED"`, 그 외 전부 `null`(PENDING을 절대 그대로 넘기지 않는다 — statusOverlay가 PENDING을 amber로 덮어 kind색을 가리므로, D8 위반).

### SC-9. 캘린더 조회 계약 (D5 DEFERRED_TO_IMPL 확정 → **전용 라우트**)

**메커니즘 확정: 전용 `GET /api/workflows/calendar` 신설**(연차 `/api/leave/calendar` 패턴). 기존 `GET /api/workflows`는 **불변**(status 필터·optional range 유지, routes.test.ts 보존). 이유: 범위-필수 계약을 캘린더 경로에 격리하고 기존 라우트/소비처를 건드리지 않음(surgical).

- 서비스 `getCalendarTasks(ctx, { start: Date; end: Date })` — **start/end 비-optional(타입 강제=서버 range 계약)** + 런타임 `start<end` 방어. `allowedKinds`로 필터 후 `findTaskList({kinds,start,end})` 위임(repo가 `scheduledAt gte start, lt end`).
- 라우트 검증(전부 400): `start`/`end` 누락·빈값·비파싱·`start≥end`·span>`MAX_WINDOW_DAYS`(46)·운영창 밖(`isAnchorWithinWindow(_, now, MAX_EDGE_MONTHS=MAX_ANCHOR_MONTHS+1=13)`). **빈 파라미터로 전체 이력 반환 금지.**
- **half-open exclusive end(R4·F2)**: 클라는 `end = winEnd`(=`normalizeToGridWindow(anchor).end` = winStart+42일, **마지막 표시 셀 다음날**)를 그대로 전송. `scheduledAt < end`라 마지막 그리드 셀([winStart+41d, winStart+42d)) 작업이 포함된다. **`winEnd-1`을 보내면 마지막 날 누락**.
- 응답: `{ items: WorkflowCalendarItem[] }`, `Cache-Control: no-store`.

상수: `MS_PER_DAY=86_400_000`, `MAX_WINDOW_DAYS=46`(6주 그리드=42일+여유), `MAX_EDGE_MONTHS=13`. (`MAX_ANCHOR_MONTHS=12`는 `@/modules/calendar/constants`.)

### SC-10. 권한·리소스·시드 (catalog + seed)

- `RESOURCES`(catalog.ts) += `"workflows.weeklyClient"`, `"workflows.monthlyClient"`, `"workflows"`(집계, D13). → seed VIEW_RESOURCES가 `…:view` 자동 생성(`workflows.weeklyClient:view`, `workflows.monthlyClient:view`, **`workflows:view`**).
- `EXTRA_PERMISSIONS`(seed-permissions.ts) += `["workflows.weeklyClient","create"]`, `["workflows.monthlyClient","create"]`(view는 자동).
- `ROLE_ALLOW`(seed-roles.ts) fresh 시드:
  - `pm`: `["*"]` — 전부(client view+create, `workflows:view` 포함) 자동.
  - `regular-developer`/`contractor-developer`/`contractor-content`: += `"workflows.weeklyClient:view"`, `"workflows.monthlyClient:view"`, `"workflows:view"`.
  - `contractor-civil-response`: += `"workflows:view"`(민원=notification만, client view 없음. 집계만 부여해 메뉴 노출).
  - `admin`: 변경 없음(workflows 권한 0 — 위임 admin).
- client kind `create`는 **PM만**(`"*"`). 다른 role은 view만(수준 B에서 "필요 role엔 view").
- **`workflows:view` 집계는 nav 게이팅 전용**(비-scopeable → `allowedScopes`=`["all"]`이라 scope "all" grant가 `getPermissionSummary.keys`에 `workflows:view`로 나타남 — 검증 완료).

### SC-11. WorkflowType 시드 (메인 `seed.ts` — prod 갭 폐쇄)

메인 seed엔 현재 `BILLING`만 있고 `WEEKLY_REPORT`/`NOTIFICATION_BILLING`은 **seed-demo(dev 전용)**에만 있다. 일반화 모달이 offer하는 create 대상 kind에 `WorkflowType` 행이 없으면 `createTask`가 403("알 수 없는 워크플로 종류"). → **메인 seed에 create 가능한 나머지 4종을 upsert(by kind, 멱등)**. templatePath=플레이스홀더(생성기 없어 미판독).

```ts
// kind 기준 upsert(seed-demo가 만든 dev 행과 kind 충돌 없음). 신규 저장소 규약 명칭.
WEEKLY_REPORT          → { id:"weekly-report",         name:"주간보고(본부)",   templatePath:"Template/주간보고-본부",   recurrence:"weekly" }
NOTIFICATION_BILLING   → { id:"notification-billing",   name:"알림톡청구",       templatePath:"Template/알림톡청구",     recurrence:"monthly" }
WEEKLY_REPORT_CLIENT   → { id:"weekly-report-client",   name:"주간보고(고객사)", templatePath:"Template/주간보고-고객사", recurrence:"weekly" }
MONTHLY_REPORT_CLIENT  → { id:"monthly-report-client",  name:"월간보고(고객사)", templatePath:"Template/월간보고-고객사", recurrence:"monthly" }
```

### SC-12. nav 게이팅 flip + rename (D11·D13) + 배포 헬퍼

- `NAV`(catalog.ts): `workflows` 부모 `permission` → `"workflows:view"`. `workflows-list` 자식 `label` `"업무 목록"→"캘린더"`, `permission` → `"workflows:view"`. href(`/workflows`)·key 불변.
- 기존 DB는 seed가 nav를 편집보존(미갱신)하므로 배포 시 **upgrade-once 헬퍼 2개**(billing-create/leave-notif 패턴, 멱등 플래그):
  - `applyWorkflowsViewUpgrade`: 임의 `workflows.<kind>:view` 보유 role에 `workflows:view` 동반 grant(dynamic — `rolePermission.findMany`). flag=`migration.workflows-view.upgrade.applied`.
  - `applyWorkflowsNavReconcile`: 기존 nav 행 2개 label+requiredPermissionId 교정. flag=`migration.workflows-nav.reconcile.applied`.
- **seed.ts 실행 순서(중요, R5·F1)**: bootstrap → 기존 upgrade들 → **`applyWorkflowsViewUpgrade`**(grant) → WorkflowType upsert → `seedNavigation`(create-if-absent) → **`applyWorkflowsNavReconcile`**(flip). grant가 flip보다 **먼저**여야 기존 notification/billing-only role이 메뉴를 잃지 않는다.

### SC-13. 캘린더 조회 실패 에러상태 (통일 — plan R2/F2, 사용자 결정=전 캘린더 통일)

캘린더 월뷰는 조회 실패(`queryFn` throw = 400/500/네트워크)를 **조용히 빈 화면으로 위장하지 않는다** — 실제 업무/연차가 있어도 없는 것처럼 보여 누락·중복 등록을 유발(silent failure). 통합 캘린더 `src/app/(app)/calendar/calendar-view.tsx`가 이미 **정본 패턴**을 가진다(line 125):

```tsx
const { data, isError } = useQuery(...);        // isError 구독
// …CalendarMonth 렌더 후…
{isError && <p className="text-sm text-destructive">…를 불러오지 못했습니다.</p>}
```

이를 표준으로 `leave-calendar`(기존, task-07)·`workflows-calendar`(신규, task-05)에 동일 적용한다. `data?.x ?? []` 빈 폴백은 유지(로딩·부분 데이터 공존)하되 **실패 시 배너를 병행 노출**. 메시지는 도메인별("업무 캘린더를 불러오지 못했습니다."·"연차 캘린더를 불러오지 못했습니다."). `calendar-view`는 이미 준수 — **변경 없음**(정본 참조원).

---

## Task 목록

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 도메인 스캐폴딩 — enum·migration·policy·validations·ALL_KINDS·RESOURCES | [ ] | [task-01](2026-07-01-workflows-calendar/task-01-domain-scaffold.md) | — | |
| 02 | UI 색·라벨·어댑터 — kind-styles 5색·KIND_LABEL·toCalendarEvent | [ ] | [task-02](2026-07-01-workflows-calendar/task-02-ui-color-label-adapter.md) | 01 | |
| 03 | 캘린더 조회 라우트·서비스 — 서버 range 강제(D5) | [ ] | [task-03](2026-07-01-workflows-calendar/task-03-calendar-range-route.md) | 01 | |
| 04 | 생성 모달 일반화 — 작업유형 드롭다운(권한 게이트)·예정일 prefill | [ ] | [task-04](2026-07-01-workflows-calendar/task-04-create-task-modal.md) | 01, 02 | |
| 05 | 캘린더 화면 + page 교체 + list 제거 | [ ] | [task-05](2026-07-01-workflows-calendar/task-05-calendar-screen.md) | 02, 03, 04 | |
| 06 | 시드·권한·nav 배포 — RESOURCES/EXTRA/ROLE_ALLOW·WorkflowType·nav flip·upgrade 2종 | [ ] | [task-06](2026-07-01-workflows-calendar/task-06-seed-nav-deploy.md) | 01 | |
| 07 | 기존 캘린더 에러상태 통일 — leave-calendar isError 배너(SC-13) | [ ] | [task-07](2026-07-01-workflows-calendar/task-07-leave-calendar-error-state.md) | — | |

실행 순서 권장: 01 → (02, 03, 06, 07 병렬 가능) → 04 → 05. 06·07은 다른 태스크와 독립(07은 기존 leave-calendar만 수정).

## 배포(요약 — 상세는 task-06 §배포)

표준 restart(forward-safe, D12). 순서: `prisma migrate deploy`(additive enum) → `prisma generate` → `db:seed`(WorkflowType·신규 permission catalog[`workflows:view`]·**`applyWorkflowsViewUpgrade` grant → seedNavigation → `applyWorkflowsNavReconcile` flip** 순) → build → `pm2 restart`. smoke: `/workflows` 캘린더 렌더, 생성 모달 유형 목록, `/api/workflows/calendar?start=…&end=…` 200(인증), **notification-only role(민원 외주) 로그인 시 Workflows 메뉴 노출**(기존 설치 검증 — fresh seed만으론 불충분).

rollback preflight(R4·F1 ACCEPTED): 신규 kind(`WEEKLY_REPORT_CLIENT`/`MONTHLY_REPORT_CLIENT`) task 부재 확인 후 되돌림(구버전 코드는 신규 enum에 `KIND_RESOURCE`/`TRANSITIONS` 미정의 → version-skew). ops-hub dev=단일 pm2라 동시 skew 없음.
