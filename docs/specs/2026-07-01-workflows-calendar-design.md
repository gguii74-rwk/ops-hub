# 업무(Workflows) 캘린더 화면 설계

- Status: Draft (brainstorming 합의 반영 — 스코프 A 우선, 신규 kind enum·타입 추가, 생성 드롭다운 3종)
- Date: 2026-07-01
- 선행: **대금청구 백엔드/UI** 완료·머지(PR #28·#29). `WorkflowKind`/`WorkflowTask`/list·detail·create·generate·send API, `CalendarMonth`(연차 캘린더 통일, PR #22) 이미 존재.
- Roadmap: `docs/product/modernization-roadmap.md` Phase 4 (Workflows 포팅) — 업무 목록의 캘린더화(day-sync 계승)
- 마이그레이션 레퍼런스: `D:\workspace\day-sync`(`components/calendar/create-task-modal.tsx`, 캘린더 날짜 클릭 생성), 연차 캘린더(`src/app/(app)/leave/_components/leave-calendar.tsx`)
- 후속: **재사용 수신자 세트(to/참조/숨은참조)** = 별도 spec(sub-project B). 이 spec에 미포함.

## 1. 목표와 범위

기존 `/workflows`의 단순 목록을 **연차 캘린더와 동일한 월 캘린더**로 교체한다. 업무 종류별로 색이 구분되고, 날짜를 클릭하면 그날 일정 확인 + day-sync 스타일 **새 작업 등록**이 가능하다. 표현계층 위주이며 스키마는 additive(신규 enum·타입·권한·nav)만 추가한다 — 기존 워크플로 상태머신·BILLING 생성/발송 경로는 불변.

### 포함

- ① `/workflows` 목록 → **월 캘린더**(`CalendarMonth` 재사용) 교체
- ② **kind별 구분색** + **단일선택 필터 6종**(전체 / 대금청구 / 알림톡청구 / 주간보고(본부) / 주간보고(고객사) / 월간보고(고객사))
- ③ 날짜 클릭 → **팝오버**(그날 작업 목록 + "새 작업 등록") 및 셀 "+" 빠른추가
- ④ **생성 모달 일반화** — 작업유형 드롭다운(권한 있는 유형: 대금청구·알림톡청구·주간보고(본부)) + 예정일(클릭 날짜 prefill)
- ⑤ **신규 kind 2종**(주간보고 고객사·월간보고 고객사) enum·`WorkflowType`·권한·전이 정책 추가 — 필터 카테고리로 실재, 생성기 미등록(일정 예약 플레이스홀더)
- ⑥ **네비게이션 rename** — "업무 목록" → "캘린더"
- ⑦ 컴포넌트·단위 테스트(vitest + testing-library)

### 비포함 (후속/범위 밖)

- **재사용 수신자 세트(to/cc/bcc)** — sub-project B 별도 spec.
- **주간보고·알림톡·월간보고 문서 생성기** — 생성 로직은 각 기능 sub-project. 여기선 생성 액션이 상세에 노출되지 않는다(BILLING만 노출 — 기존 불변식 보존).
- **목록(리스트) 뷰 유지** — 캘린더로 완전 교체. `workflows-list.tsx`는 미사용 → 제거(내 변경이 만든 orphan).
- **상태머신/전이 규칙 변경** — 신규 kind의 전이는 기존 골격 재사용, 기존 kind는 불변.

## 2. 설계 결정 요약

| # | 결정 | 근거 |
| --- | --- | --- |
| D1 | **신규 kind 2종 enum 추가(additive 마이그레이션).** `WorkflowKind`에 `WEEKLY_REPORT_CLIENT`(주간보고 고객사)·`MONTHLY_REPORT_CLIENT`(월간보고 고객사) 추가. **타입상 강제되는** `KIND_RESOURCE`·`TRANSITIONS`(둘 다 `Record<WorkflowKind,…>` 완전매핑 — 누락 시 typecheck 실패)·`KIND_LABEL` 동반 갱신. **⚠ 조회 allow-list는 typecheck가 강제하지 못함**: `getTaskList`의 `ALL_KINDS`(`tasks.ts:17`)·`/workflows` page의 `KINDS`는 손수 작성한 `WorkflowKind[]` 배열이라, enum에만 추가하고 이 배열을 놓치면 **타입 오류 없이 API가 신규 kind를 영구 누락**(필터가 빈 카테고리). → **두 배열을 enum-파생 단일 출처(`Object.keys(KIND_RESOURCE) as WorkflowKind[]`)로 대체**(§4.5·F1) | 사용자 결정(브레인스토밍 Q1): UI-only 플레이스홀더 대신 실제 kind로 스캐폴딩 — 향후 생성기는 등록만으로 활성화. Record 파생으로 조회 경로도 enum과 자동 동기화(완전매핑 Record가 유일한 typecheck-강제 출처) |
| D2 | **신규 kind 전이 = WEEKLY_REPORT 골격 재사용.** `PENDING→[GENERATED,CANCELLED]`, `GENERATED→[SENT,CANCELLED]` | 생성기가 없어 실제 GENERATED 진입은 불가하나, 상태머신은 정의돼야 타입·정책 일관. 예약(PENDING) + 취소만 실질 동작 |
| D3 | **신규 kind 권한 = 리소스 2종 신설**(`workflows.weeklyClient`·`workflows.monthlyClient`), 1:1 kind↔resource 기존 패턴 유지. **seed-roles는 신규 client kind에 `view`만 부여, `create`/`generate`/`send`는 미부여**(생성기 구현 시 부여). `RESOURCES`·`seed-roles`(PM/configured role view) 갱신 | 독립 게이팅 + 향후 생성기 활성화 시 등록·grant만 추가. **create 미부여가 곧 생성 차단 게이트**(F1): 서버 `createTask`가 `<kind>:create`를 검사하므로, client kind는 UI 드롭다운 숨김(권한 없음) + 서버 403이 **동일 키로 일관**(접근제어 규칙① 준수, 별도 allow-list 불필요). OWNER 전능은 by-design(placeholder PENDING만 생성, 무해) |
| D4 | **캘린더 = `CalendarMonth` 재사용**(anchor·events·intensity·onQuickAdd·renderDayDetail). 운영창 ±`MAX_ANCHOR_MONTHS`·KST cursor·그리드 윈도우 패칭 | 연차 캘린더(PR #22)와 동일 컴포넌트·관례. 신규 캘린더 코드 최소화, module→ui 경계 준수(팝오버는 CalendarMonth 내장) |
| D5 | **데이터 = 기존 `GET /api/workflows?start&end`**(이미 지원). kind 필터는 **클라이언트 필터**(응답 `kind` 사용) | 워크플로 kind는 민감정보 아님(연차의 서버측 직무필터와 다름). 새 API·백엔드 변경 0. 그리드 42칸 윈도우를 start/end로 패칭 |
| D6 | **필터 = 단일선택 6개**(전체 + 5 kind), 연차 `전체/개발/민원/콘텐츠` UX 동일 | 익숙한 패턴. 다중선택은 YAGNI |
| D7 | **kind별 구분색** — `kind-styles`에 5색 additive 추가: 대금청구=주황 / 알림톡청구=청록 / 주간보고 본부=인디고 / 주간보고 고객사=보라 / 월간보고 고객사=핑크. `kind` 키 = `WorkflowKind` enum 문자열 | 종류 식별성. 통합 캘린더의 `WORKFLOW_TASK`(단일 주황)와 별개(additive, 충돌 없음) |
| D8 | **상태 오버레이 = CANCELLED만 취소선.** PENDING 등은 kind색 유지(연차의 대기=주황 오버레이 미적용) | 워크플로 PENDING은 정상 상태(승인대기 아님). kind색을 덮으면 식별성 저하. WorkflowStatus→EventStatus 매핑: CANCELLED→CANCELLED, 그 외→null |
| D9 | **날짜 클릭 = 팝오버(그날 작업 목록 + "새 작업 등록") + 셀 "+" 빠른추가.** 둘 다 클릭 날짜 prefill로 생성 모달 오픈 | 연차 팝오버 + day-sync 생성의 병합. 작업 클릭 시 `/workflows/[id]` 상세 이동. 생성 권한 없으면 미노출(읽기 전용) |
| D10 | **생성 모달 일반화** — `create-task-modal.tsx` 확장: 작업유형 드롭다운(`Select`, 권한 있는 유형만: 대금청구·알림톡청구·주간보고 본부) + 예정일. `POST /api/workflows {kind, scheduledAt}`(기존 계약, billing-ui D12). `guardedClose` 유지 | 사용자 결정(Q2). 신규 고객사 kind는 드롭다운 미포함(구현예정). 권한 유형 1개뿐이면 고정 표시. `createTaskSchema`가 모든 생성가능 kind 수용해야(검증) |
| D11 | **네비 rename** — `catalog.ts` `workflows-list` 라벨 "업무 목록"→"캘린더". seed는 편집보존(기존 DB 행 미갱신) → **배포 시 멱등 DB 업데이트 1회**로 라벨 교정. href(`/workflows`)·key 불변 | 신규 설치는 카탈로그 반영, 기존 환경은 CMS/DB 갱신. 부모 "업무" 클릭→첫 자식(캘린더) 이동 accordion 동작 유지 |
| D12 | **범위 = 표현계층 + additive 스키마.** 마이그레이션은 additive(enum 값·`WorkflowType` 행) → **표준 restart 배포**(비가역 아님). 기존 상태머신·BILLING 경로 무변경 | 위험 낮음. 신규 kind seed는 `templatePath` 플레이스홀더(생성기 없어 미판독) |

## 3. 모듈 구조와 경계

```
src/app/(app)/workflows/
  page.tsx                  # 변경 — WorkflowsList → WorkflowsCalendar 렌더
  workflows-calendar.tsx    # 신규 — CalendarMonth 재사용 + 필터 + 팝오버 + 생성 모달 트리거(client)
  workflows-list.tsx        # 제거 — 캘린더로 교체(orphan)
  create-task-modal.tsx     # 변경 — 작업유형 드롭다운(권한 게이트) + 예정일 prefill 일반화
  labels.ts                 # 변경 — KIND_LABEL에 신규 2종(고객사) 추가, 필터 순서 정의
  workflow-calendar-adapter.ts  # 신규(선택) — WorkflowTask → CalendarEventInput 순수 변환(kind·title·상태→오버레이)

src/modules/workflows/policy.ts   # 변경 — KIND_RESOURCE·TRANSITIONS 신규 2종
src/modules/calendar/ui/kind-styles.ts  # 변경 — 워크플로 5 kind 색 additive
src/kernel/access/catalog.ts      # 변경 — RESOURCES 2종 추가, nav "업무 목록"→"캘린더"
prisma/schema.prisma              # 변경 — WorkflowKind enum 2값
prisma/migrations/<ts>_workflow_client_kinds/  # 신규 — additive enum 마이그레이션
prisma/seed.ts / seed-roles.ts    # 변경 — WorkflowType 2행, 신규 리소스 권한 grant
scripts/                          # 신규(선택) — nav 라벨 멱등 업데이트 스크립트(배포용)
```

경계: 캘린더 UI는 `CalendarMonth`(module)만 소비하고 `@/components/ui/*`는 페이지·모달에서만 사용(module→ui 금지 유지). 어댑터는 순수함수(단위테스트 1층).

## 4. 상세 설계

### 4.1 캘린더 화면 (`workflows-calendar.tsx`)

연차 캘린더 구조를 그대로 계승:

- KST `cursor`(연/월), `anchor = Date.UTC(y, m, 15, 3)`, 그리드 윈도우 `normalizeToGridWindow(anchor)` → `startKey`/`endKey`.
- `useQuery(["workflows","calendar",startKey,endKey], () => fetch(\`/api/workflows?start=${encodeURIComponent(startKey)}&end=${encodeURIComponent(endKey)}\`))` — **start/end 값을 반드시 실어 그리드 42칸 윈도우만 조회**(F2). 빈 `?start&end`는 라우트 `parseOptionalDate`가 null 처리 → 무제한(전체 이력) 조회가 되므로 금지. 상태 필터는 없음(취소 포함 — §4.4).
- `selectedKind` 상태(단일). `visible = items.filter(kind === selectedKind || selectedKind==="ALL")` **클라 필터**.
- `events = items.map(toCalendarEvent)` — 단일일 이벤트, `kind`=WorkflowKind, `title`=유형라벨+식별(예: "대금청구"), `status`=CANCELLED만 오버레이.
- 툴바: 좌=필터 6버튼 + 년월, 우=이전/오늘/다음(운영창 밖 비활성, 연차와 동일).
- 범례: 색 안내(정적) — 존재하는 kind 색칩 + CANCELLED 취소선 안내.

### 4.2 날짜 팝오버 + 생성 (`renderDayDetail`)

```
renderDayDetail({dateKey, events, close}) =>
  - 그날 작업 목록(없으면 "업무 없음"): 각 항목 kind배지 + 제목, 클릭 → /workflows/[id]
  - canCreateAny 이면: "새 작업 등록" 버튼 → close(); openCreate(dateKey)
onQuickAdd = canCreateAny ? (dateKey) => openCreate(dateKey) : undefined
```

`canCreateAny` = 생성가능 3종 중 하나라도 `:create` 권한 보유.

### 4.3 생성 모달 (`create-task-modal.tsx`)

- props: `{ defaultDate?: string; onClose }`.
- 작업유형 `Select`: 옵션 = 생성가능 kind 중 `useCan(resource,"create")` true인 것(대금청구·알림톡청구·주간보고 본부). 옵션 0개면 모달 진입 불가(트리거가 이미 게이트). 1개면 그 값 고정.
- 예정일 `Input[type=date]`, `defaultDate` prefill.
- 제출: `POST /api/workflows { kind, scheduledAt }` → 성공 시 `/workflows/[id]`로 이동. `guardedClose`(제출 중 닫기 차단) 유지. 실패 토스트(403="작업 생성 권한이 없습니다.").

### 4.4 취소된 작업 표시

- 목록 API 기본은 전체 상태. 캘린더는 **CANCELLED 포함해 표시하되 취소선**(D8) — 취소 이력 가시성. (대안: CANCELLED 제외. plan에서 확정하되 기본=포함+취소선.)

### 4.5 신규 kind 스캐폴딩

- enum: `WEEKLY_REPORT_CLIENT`, `MONTHLY_REPORT_CLIENT`.
- `KIND_RESOURCE`: `workflows.weeklyClient`, `workflows.monthlyClient`.
- `TRANSITIONS`: WEEKLY_REPORT와 동일 골격(D2).
- `KIND_LABEL`(필터·배지 공통 **단일 라벨 출처**): 5종을 사용자 명칭으로 통일 — `BILLING`="대금청구", `NOTIFICATION_BILLING`="알림톡청구"(기존 "알림톡"에서 명확화), `WEEKLY_REPORT`="주간보고(본부)"(기존 "주간보고"에서), `WEEKLY_REPORT_CLIENT`="주간보고(고객사)", `MONTHLY_REPORT_CLIENT`="월간보고(고객사)". enum 값 자체는 불변(라벨만 변경). 상세/배지 등 KIND_LABEL 소비처는 자동 반영.
- `RESOURCES`(catalog) 2종 추가 + `seed-roles`: **신규 client kind는 `view`만 부여**(create/generate/send 미부여 — D3·F1). 조회는 PM/필요 role.
- `WorkflowType` seed 2행: `name`(고객사 주간/월간보고), `templatePath` 플레이스홀더, `recurrence`.
- `createTaskSchema`: enum 전체를 수용해도 **서버 `createTask`의 `<kind>:create` 게이트가 실제 관문**(F1). 신규 client kind는 create 권한 미부여(D3)라 일반 role은 403 — 스키마가 파싱을 통과시켜도 서비스 계층에서 차단(UI 숨김만으로 의존하지 않음, 접근제어 규칙①). OWNER는 by-design 예외. 별도 `CREATABLE_WORKFLOW_KINDS` allow-list는 두지 않는다(권한 grant가 단일 출처 — 이중화 방지).
- **조회 allow-list 단일화(F1, 필수)**: `getTaskList`의 `ALL_KINDS`(`tasks.ts:17`)와 `/workflows` page의 `KINDS` 하드코딩 배열을 **`Object.keys(KIND_RESOURCE) as WorkflowKind[]`** 로 대체(완전매핑 Record라 신규 kind가 자동 포함). 이렇게 해야 신규 kind가 `GET /api/workflows`에 반환되고 캘린더 필터가 빈 카테고리가 되지 않는다.

## 5. 권한 (접근제어 규칙 ①②)

| 화면/동작 | permission key |
| --- | --- |
| 캘린더 조회(각 kind 이벤트) | `workflows.<kind>:view` — 서버 `getTaskList`가 이미 kind별 view로 필터 |
| 작업 생성(모달) | `workflows.<kind>:create` — UI `useCan` + 서버 `createTask` 동일 키 |
| 상세 이동 | 기존 detail 권한 |

메뉴 숨김은 UX, API도 동일 키 검사(fail-closed). 신규 리소스 grant 없으면 OWNER만 보임(테스트는 OWNER로 즉시 가능, 정식 grant는 seed-roles).

**client kind 생성 차단(F1)**: 신규 client kind는 `create` 미부여(D3)이므로 UI 드롭다운 숨김 + 서버 `createTask` 403이 동일 키로 일관. UI 숨김에만 의존하지 않는다(접근제어 규칙①).

**나머지 판정 — nav 권한 모델(OUT_OF_SCOPE)**: 현재 nav `workflows` 부모·자식은 단일 `requiredPermissionId = workflows.weekly:view`로 게이트된다. `workflows.billing`만 보유한(weekly view 없는) 커스텀 role은 페이지/API로는 접근되나 메뉴가 안 보이는 **기존 mismatch**가 있다. 이번 rename은 key/href/permission을 **보존**하므로 신규 regression이 아니다. nav를 "임의 kind view(any-of)/집계 workflows:view"로 바꾸는 것은 **nav 단일-permission 모델 변경 = access-control follow-up**이며, billing-ui 리뷰(F-B2)에서 이미 OUT_OF_SCOPE로 판정된 사안이다(별도 후속). 이 spec 범위 밖.

## 6. 테스트

- 어댑터 순수함수: WorkflowTask→CalendarEventInput(kind·title·CANCELLED 오버레이), kind→라벨·색.
- `workflows-calendar`: 필터 단일선택 전환, kind 미스매치 숨김, 빈 상태, 팝오버 목록·생성 버튼 노출(권한별), 운영창 nav 비활성.
- **조회 kind 커버리지 회귀(R1)**: 신규 kind(`WEEKLY_REPORT_CLIENT`/`MONTHLY_REPORT_CLIENT`)가 view 권한 보유 시 `getTaskList`(및 `GET /api/workflows`)에 반환되는지 — `ALL_KINDS`가 `Object.keys(KIND_RESOURCE)`로 enum 전체를 커버함을 보장.
- **range fetch 회귀(R1)**: 캘린더 `queryFn`이 만드는 요청 URL에 **`start`/`end` 값이 실제로 포함**되는지(빈 파라미터 아님).
- **client kind 생성 차단 회귀(R2·F1)**: create 미부여 role(OWNER 아님)이 `POST /api/workflows {kind: WEEKLY_REPORT_CLIENT}` 직접 호출 시 **403**(UI 우회 차단) — `createTask`의 `<kind>:create` 게이트 검증.
- `create-task-modal`: 유형 드롭다운 권한 게이트, defaultDate prefill, 제출 payload(`{kind,scheduledAt}`), guardedClose.
- react-query·useCan·fetch·toast mock 관례(billing-ui와 동일). `npm test`는 `.env`(DATABASE_URL) 필요.

## 7. 배포

표준 restart(**forward-safe**, D12): `prisma migrate deploy`(additive enum) → `prisma generate` → `db:seed`(WorkflowType 2행·신규 권한·nav 라벨은 편집보존이라 미갱신) → **nav 라벨 멱등 업데이트 1회**(D11) → build → `pm2 restart`. smoke: `/workflows` 캘린더 렌더, 생성 모달 유형 목록, `/api/workflows?start=…&end=…` 200(인증).

**rollback/backout(R2·F2)**: additive enum은 **forward-safe**이나 **rollback은 자동 안전하지 않음** — 구버전 코드는 신규 enum 값에 대해 `KIND_RESOURCE`/`TRANSITIONS`가 미정의라, 신규 kind task가 이미 존재하면 상세/전이에서 실패(version-skew). 완화: (1) 신규 client kind는 **create 미부여**(D3·F1)라 일반 경로로 생성 불가 → 노출 최소, (2) ops-hub dev는 **단일 pm2 인스턴스**(rolling 아님)라 동시 version-skew 없음, (3) rollback 필요 시 **신규 kind task 부재 확인 후** 구버전 배포(존재 시 정리/비활성 선행). 운영 cutover 다중 인스턴스 시엔 "신규 enum 허용 코드 선배포 → 이후 grant/생성 노출" 2-phase 적용.
