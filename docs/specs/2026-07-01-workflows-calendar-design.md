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
| D1 | **신규 kind 2종 enum 추가(additive 마이그레이션).** `WorkflowKind`에 `WEEKLY_REPORT_CLIENT`(주간보고 고객사)·`MONTHLY_REPORT_CLIENT`(월간보고 고객사) 추가. 타입상 강제되는 `KIND_RESOURCE`·`TRANSITIONS`·`KIND_LABEL` 동반 갱신 | 사용자 결정(브레인스토밍 Q1): UI-only 플레이스홀더 대신 실제 kind로 스캐폴딩 — 향후 생성기는 등록만으로 활성화. `Record<WorkflowKind,...>` 완전매핑이라 누락 시 typecheck가 강제(안전장치) |
| D2 | **신규 kind 전이 = WEEKLY_REPORT 골격 재사용.** `PENDING→[GENERATED,CANCELLED]`, `GENERATED→[SENT,CANCELLED]` | 생성기가 없어 실제 GENERATED 진입은 불가하나, 상태머신은 정의돼야 타입·정책 일관. 예약(PENDING) + 취소만 실질 동작 |
| D3 | **신규 kind 권한 = 리소스 2종 신설**(`workflows.weeklyClient`·`workflows.monthlyClient`), 1:1 kind↔resource 기존 패턴 유지. `RESOURCES`·`seed-roles`(PM 풀권한, 조회는 configured role) 갱신 | 독립 게이팅 + 향후 생성기 활성화 시 권한 재작업 불필요. 기존 3 kind의 1:1 매핑과 대칭 |
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
- `useQuery(["workflows","calendar",startKey,endKey], () => fetch('/api/workflows?start&end'))` — 상태 필터 없이 전체(취소 포함? — §4.4).
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
- `RESOURCES`(catalog) + `seed-roles` grant(PM view/create/…; 조회는 필요한 role).
- `WorkflowType` seed 2행: `name`(고객사 주간/월간보고), `templatePath` 플레이스홀더, `recurrence`.
- `createTaskSchema`: 모든 kind 수용 확인(신규 2종은 드롭다운 미노출이라 UI 생성 불가하나 스키마는 enum 전체 허용 무해).

## 5. 권한 (접근제어 규칙 ①②)

| 화면/동작 | permission key |
| --- | --- |
| 캘린더 조회(각 kind 이벤트) | `workflows.<kind>:view` — 서버 `getTaskList`가 이미 kind별 view로 필터 |
| 작업 생성(모달) | `workflows.<kind>:create` — UI `useCan` + 서버 `createTask` 동일 키 |
| 상세 이동 | 기존 detail 권한 |

메뉴 숨김은 UX, API도 동일 키 검사(fail-closed). 신규 리소스 grant 없으면 OWNER만 보임(테스트는 OWNER로 즉시 가능, 정식 grant는 seed-roles).

## 6. 테스트

- 어댑터 순수함수: WorkflowTask→CalendarEventInput(kind·title·CANCELLED 오버레이), kind→라벨·색.
- `workflows-calendar`: 필터 단일선택 전환, kind 미스매치 숨김, 빈 상태, 팝오버 목록·생성 버튼 노출(권한별), 운영창 nav 비활성.
- `create-task-modal`: 유형 드롭다운 권한 게이트, defaultDate prefill, 제출 payload(`{kind,scheduledAt}`), guardedClose.
- react-query·useCan·fetch·toast mock 관례(billing-ui와 동일). `npm test`는 `.env`(DATABASE_URL) 필요.

## 7. 배포

표준 restart(비가역 아님, D12): `prisma migrate deploy`(additive enum) → `prisma generate` → `db:seed`(WorkflowType 2행·신규 권한·nav 라벨은 편집보존이라 미갱신) → **nav 라벨 멱등 업데이트 1회**(D11) → build → `pm2 restart`. smoke: `/workflows` 캘린더 렌더, 생성 모달 유형 목록, `/api/workflows?start&end` 200(인증).
