# 연차 캘린더 직무 필터 + 범례 통일 + 공휴일 표시 — 설계

- 작성일: 2026-06-26
- 대상: 연차 캘린더(`/leave` → `LeaveCalendar`)
- 상태: 설계 확정(목업 승인 완료), 구현 계획 대기

## 1. 배경·목적

연차 기능은 **외주 직원(CONTRACTOR)만** 사용한다(정규직은 본사 그룹웨어로 관리). 연차 캘린더는 외주 직원의 부재 현황을 보는 화면이다. 현재 화면에 세 가지를 추가·정리한다.

1. **직무 필터**: 좌측에 `전체/개발/민원/콘텐츠` 버튼을 두고, 선택한 직무 인원의 휴가만 보이게 한다.
2. **범례 통일(변형 A)**: 공휴일·연차·반차·반반차·대기중·반려/취소를 **동일한 칩 디자인으로 한 줄**에 표시한다.
3. **공휴일 표시**: 휴가만 보여주던 캘린더에 공휴일을 실제로 띄운다.
4. **레이아웃**: nav(이전·오늘·다음)를 **우측**으로, 직무 필터를 **좌측**으로 배치한다.

> 통합 캘린더(`/calendar`)에 구글 캘린더 휴가 + 연차 휴가를 합산 표시하는 것은 **이번 범위 밖**(향후 별도 설계).

## 2. 결정 사항

- **D1. 직무 필터 = 서버 필터(데이터 최소화 원칙).** 선택 직무를 쿼리 파라미터 `job`(`ALL|DEVELOPER|CIVIL_RESPONSE|CONTENT_MANAGER`)으로 보내면 **서버가 해당 직무 인원의 휴가만** 반환한다. 응답에 `jobFunction`을 싣지 않는다 — 클라이언트는 신뢰 경계 밖이므로 표시에 불필요한 코워커 HR 속성을 내려보내지 않는다(ops-hub 전 화면 표준: 백엔드 최소 정보·서버 필터). 단일 선택(라디오), 기본값 `전체`. 버튼 변경 시 재요청 — 캘린더는 이미 월 이동 시 재요청하므로 fetch query key에 `job`을 더하는 수준(클릭→서버 왕복 트레이드오프 수용).
- **D2. 직무 버튼 = 고정 4개**: `전체 / 개발(DEVELOPER) / 민원(CIVIL_RESPONSE) / 콘텐츠(CONTENT_MANAGER)`. PM은 제외(외주에 사실상 없음). PM 직무 인원이 데이터에 있어도 `전체`에서는 보이되 단독 필터 버튼은 없음.
- **D3. 종류별 토글 필터 제거.** 기존 `CalendarMonth` 내부 kind 토글(연차/반차/반반차 클릭 숨김)을 끄고(`legend={false}`), 범례를 **정적 색 안내**로 전환한다. 필터 역할은 직무 필터가 담당.
- **D4. 범례 변형 A 스타일** = 채운 pill + 얇은 테두리 + **글자색 700**(각 색의 진한 톤). `대기중`=주황 배경·진한 노랑 점선, `반려/취소`=취소선. 공휴일=붉은색(rose).
- **D5. 공휴일은 직무와 무관하게 항상 표시.** 직무 필터를 어떤 값으로 두어도 공휴일은 남는다(`kind === "HOLIDAY"`는 필터 예외).
- **D6. 공휴일은 별도 응답 필드로 전달.** API 응답을 `{ events, holidays }`로 확장한다(D9에서 `unsyncedYears`가 추가돼 최종 `{ events, holidays, unsyncedYears }`). 휴가 전용 필드(`leaveType`/`status`/`isSelf` 등)를 공휴일에 억지로 채우지 않기 위함. 클라이언트가 각각 공통 이벤트 모델로 변환.
- **D7. 권한·마스킹은 기존 정책 유지 + jobFunction 미노출.** 이름·유형은 이미 공개, 사유·세부는 admin 외 마스킹(`getLeaveCalendar` line 104). 직무 필터는 **서버에서** 적용하므로 **`jobFunction`을 응답/`LeaveCalendarEvent`에 포함하지 않는다**(데이터 최소화 — 코워커 직무 속성 추가 노출 방지, 적대검증 F8). 직무 필터는 뷰어가 **이미 볼 수 있는 데이터 범위 안에서만** 적용된다(일반=본인+같은 팀 APPROVED, status=전 팀 APPROVED, admin=전체) — 직무 userId 집합과 권한 스코프의 **교집합**.
  - **수용된 잔여(적대검증 F9, jobFunction 오라클):** `jobFunction`을 응답 필드로 안 보내도, 버튼을 순회하면 **가시 범위 내 코워커의 coarse 직무(4종)를 추론**할 수 있다(응답 차이 자체가 오라클). 이는 *이름이 보이는 사용자에게 per-job 필터를 제공*하는 한 기능 내재적 — 완전 차단하려면 일반 사용자에게 직무 필터를 주지 않아야 하나 그러면 외주 자체조회 목적(§1)이 무너진다. **수용 근거:** 노출은 (a) 이미 이름이 보이는 APPROVED 이벤트 한정, (b) coarse 4종, (c) 사실상 외주 전용 소규모 데이터. **보완:** 직무를 엄격 비공개로 둬야 하면 필터를 `leave.status:view`/admin 등 직무 조회 권한자에게만 노출하도록 제한(§6 후속).
- **D8. 조회 경로는 동기화하지 않는다(read-only).** 캘린더 read GET은 외부 공휴일 동기화를 트리거하지 않는다. `Holiday` 테이블에 **이미 있는 공휴일만** 읽어 표시하고, 채우기는 기존 통로 — 부팅 시 current+익년(fire-and-forget, `instrumentation.ts`) · 연차 신청 백스톱(`createLeaveRequest` fail-closed) · admin 수동 동기화(`api/admin/leave/holidays/sync`) — 에 맡긴다. **이유(적대검증 F4):** read GET에서 `ensureYearsSynced`를 await하면 키 부재(`DATA_GO_KR_SERVICE_KEY`)·외부 API 장애 시 평범한 조회가 외부 호출에 블로킹되고, leave `Holiday` 테이블엔 통합 캘린더의 `CalendarSource`(TTL·`lastFetchedAt`) 같은 per-year fetch 상태가 없어 미적재(count===0) 연도는 **매 로드마다 재시도**된다. 미동기화 연도는 자동으로 채우지 않고 **D9 신호로 노출**한다. (정상 사용 = current/인접 월은 부팅 적재돼 공휴일이 정상 표시; 자동 채움이 필요해지면 durable sync-state를 후속으로 — §6.)
- **D9. 미동기화는 조용히 비우지 않고 신호한다(주 메커니즘).** 라우트는 조회 윈도우가 걸친 연도에 대해 `getUnsyncedYears(years)`로 미적재 연도를 계산해 응답을 `{ events, holidays, unsyncedYears }`로 확장한다(통합 캘린더 피드의 `failedSources` 선례와 동일한 부분실패 메타데이터). `unsyncedYears`는 **'공휴일을 신뢰할 수 없는 연도'**를 뜻한다 — 미적재 연도뿐 아니라 **공휴일 조회/probe가 throw한 경우도 보수적으로 윈도우 전체 연도를 여기 담는다**(§3.3, F3). 비어있지 않으면 클라이언트는 "{연도} 공휴일 정보를 불러오지 못했습니다" 수준의 **간단한 인라인 안내**(차단 모달 아님)를 표시해, 빈 공휴일이 '공휴일 없음'으로 오인되지 않게 한다. 따라서 `{ holidays: [], unsyncedYears: [] }`는 **'윈도우 연도가 모두 적재됨 + 진짜 공휴일 없음'일 때만** 발생하고, 미적재·실패가 깨끗한 빈 상태로 둔갑하지 않는다. (안내는 미적재 연도로 네비게이트했을 때만 뜨고, 정상 월에는 나타나지 않는다.)
- **D10. 조회 윈도우 입력 검증(하드닝).** 라우트는 ① `start <= end`, ② **윈도우 일수 상한** `end - start <= 46일`(월 그리드 한 화면 = 최대 6주, 통합 캘린더 feed의 `normalizeToGridWindow`와 동일 폭), ③ 양 끝을 운영 창(`now ± MAX_ANCHOR_MONTHS`, feed와 동일 상수·`isAnchorWithinWindow` 재사용)으로 제한한다. 위반 시 400. ②는 자유 범위로 수백 일치 leaveRequest·user를 대량 조회/enumerate하는 것을(적대검증 F7/F10), ③은 먼 과거/미래로의 enumerate를 막아 feed와 **동일한 바운드 모델**로 통일한다. 일수 상한으로 윈도우가 걸친 연도는 자동으로 ≤2. (동기화는 D8로 제거됐고, 이건 조회 자체의 enumeration·쿼리 폭주 하드닝.)

## 3. 변경 상세 (계층별)

### 3.1 공휴일 조회 — `src/kernel/holidays/index.ts`
- 신규 `getHolidayEventsInRange(start, end): Promise<{ date: string; name: string }[]>` 추가.
  - `prisma.holiday.findMany({ where: { date: { gte, lte } }, select: { date, name }, orderBy: { date: "asc" } })`
  - `date`는 `"YYYY-MM-DD"`(UTC, 기존 `getHolidaysInRange`와 동일 규칙)로 변환.
- 기존 `getHolidaysInRange`(Set, 신청 검증용)는 **그대로 둔다**(소비처: 신청 fail-closed 게이트).

### 3.2 휴가 조회 서비스 — `src/modules/leave/services/calendar.ts`
- `getLeaveCalendar` 파라미터에 `job?: JobFunction | null`(없거나 `ALL` 의미면 무필터) 추가.
- `job`이 주어지면 해당 `jobFunction`의 ACTIVE userId 집합을 조회(`prisma.user.findMany({ where: { jobFunction: job, status: "ACTIVE" }, select: { id } })`)해, 기존 권한 스코프 `where`에 `userId in {jobUserIds}` 제약을 **AND로 교집합**한다(빈 집합이면 빈 결과). `LeaveRequest`엔 user 관계가 없어(userId 스칼라) userId 집합으로 거른다 — 기존 별도 user 조회 패턴 유지. self도 동일하게 적용(직무가 다르면 본인 휴가도 그 필터에선 제외).
- **`LeaveCalendarEvent`/응답에 `jobFunction`을 추가하지 않는다**(D7, 데이터 최소화). 이름 조회 쿼리(line 96)는 그대로(`name`만).

### 3.3 API 라우트 — `src/app/api/leave/calendar/route.ts`
- **윈도우 입력 검증(D10)**: `start <= end` + 일수 상한(`end - start <= 46일`) + 양 끝 운영 창(`now ± MAX_ANCHOR_MONTHS`, `isAnchorWithinWindow` 재사용). 위반 시 400.
- **`job` 파싱·검증**: 쿼리 `job`이 `DEVELOPER|CIVIL_RESPONSE|CONTENT_MANAGER` 중 하나면 그 값을, 없거나 `ALL`이면 무필터(`null`)로 `getLeaveCalendar(..., job)`에 전달. 그 외 값 → 400(엄격 검증, 화이트리스트).
- 조회 윈도우가 걸친 연도 집합을 계산한다(`start.getUTCFullYear()`..`end.getUTCFullYear()` 포함; D10으로 ≤2).
- **동기화는 호출하지 않는다(D8, read-only)** — `Holiday` 테이블을 있는 그대로 읽는다.
- `getLeaveCalendar(...)` 호출 후 `getHolidayEventsInRange(start, end)`와 `getUnsyncedYears(years)`를 호출.
- 응답을 `{ events, holidays, unsyncedYears }`로 확장(D9, 기존 `{ events }`에서 확장).
- **미적재·실패를 깨끗한 빈 상태로 둔갑시키지 않는다(D9 불변식, F3)**: 미적재 연도는 `getUnsyncedYears`가 `unsyncedYears`에 담는다. 추가로 `getHolidayEventsInRange` 또는 `getUnsyncedYears`가 throw하면 로그 후 `holidays: []` + `unsyncedYears`에 **윈도우 전체 연도**를 담아(보수적 degraded 신호) 클라이언트가 경고를 띄우게 한다. 즉 `{ holidays: [], unsyncedYears: [] }`는 '윈도우 연도가 모두 적재됨 + 진짜 공휴일 없음'일 때만 가능. (휴가 조회 실패는 기존대로 에러.)

### 3.4 어댑터 — `src/app/(app)/leave/_components/leave-adapter.ts`
- 신규 `holidaysToEvents(hs: { date: string; name: string }[]): CalendarEventInput[]`
  - `kind: "HOLIDAY"`, `title: name`, `allDay`, half-open(`allDayHalfOpen`) 단일 날짜, `status` 없음.
  - `id: "holiday:" + date`.
- `CalendarEventInput`·`Ev`(휴가 응답)는 **건드리지 않는다** — 직무 필터가 서버로 이동(D1)해 응답에 `jobFunction`이 없으므로 추가 필드 불필요.

### 3.5 컴포넌트 — `src/app/(app)/leave/_components/leave-calendar.tsx`
- **상태**: `selectedJob: "ALL" | JobFunction`(기본 `"ALL"`) — **fetch 쿼리의 일부**(클라 필터 아님). `ALL`이 아니면 `job` 파라미터로 실어 재요청(month 이동과 동일한 재요청 경로, query key에 `job` 추가).
- **이벤트 변환**(서버가 이미 직무로 걸러 반환):
  ```
  const events = [...leaveToEvents(data?.events ?? []), ...holidaysToEvents(data?.holidays ?? [])];
  ```
  공휴일은 `job`과 무관하게 서버가 항상 반환하므로 그대로 포함(D5).
- **툴바 레이아웃**: 좌측 직무 버튼(전체/개발/민원/콘텐츠) + 년월, 우측에 이전/오늘/다음(`ml-auto`). 새로고침 버튼 없음.
- **범례**: `CalendarMonth`의 `legend`를 끄고(D3), 변형 A 정적 범례를 직접 렌더(공휴일·연차·반차·반반차·대기중·반려/취소). 직무 버튼은 4개 고정이므로 라벨/값(`{ value: "ALL"|JobFunction, label }`)을 컴포넌트 내 상수로 인라인 정의(`admin/users/_components/labels.ts`의 `JOB_LABEL`은 admin 전용 private 영역이라 직접 import하지 않음).
- 기존 상단 상태 키 줄(이전 작업에서 추가한 대기중/반려)은 변형 A 범례에 흡수되어 제거.
- **미동기화 안내**(D9): `data?.unsyncedYears`가 비어있지 않으면 캘린더 상단에 간단한 인라인 안내(예: "{연도} 공휴일 정보를 불러오지 못했습니다")를 표시한다. 차단 모달이 아니라 범례/그리드와 공존하는 한 줄. `unsyncedYears`가 없거나 빈 배열이면 표시하지 않는다.

### 3.6 칩 색 — `src/modules/calendar/ui/kind-styles.ts`
- 연차 캘린더가 쓰는 kind(`ANNUAL/HALF/QUARTER/HOLIDAY`)의 **soft 글자색을 950 → 700**으로 조정(변형 A). 배경 100·테두리(ring 또는 border) 유지.
- `HOLIDAY`는 통합 캘린더도 공유 → 통합 캘린더 팝오버의 공휴일 글자색도 700이 됨(무해, 일관).
- 통합 캘린더 전용 kind(`INTERNAL_LEAVE`/`WORKFLOW_TASK`/`EXTERNAL_*`/`PERSONAL`/`TEAM`)는 **이번에 건드리지 않는다**(범위 밖).
- `statusOverlay`(PENDING/REJECTED/CANCELLED)는 직전 작업 결과 그대로 유지.

### 3.7 범례 라벨
- 변형 A 정적 범례를 직접 렌더하므로 `legendLabel`은 불필요해질 수 있음. 정적 범례 칩에 한국어 라벨(공휴일/연차/반차/반반차/대기중/반려·취소)을 직접 기재.

## 4. 데이터·권한

- 직무 필터는 **표시 필터**일 뿐 권한 경계가 아니다. 서버가 권한대로 좁힌 범위(일반=본인+같은 팀 APPROVED, status:view=전 팀 APPROVED, admin=전체·전 상태) 안에서 **추가로 직무로 교집합**해 반환한다.
- `jobFunction`은 응답에 **포함하지 않는다**(D7, 데이터 최소화). 필터링이 서버에서 끝나므로 코워커 직무 속성이 클라이언트로 나가지 않는다 — 기존 노출(이름·유형)에서 늘어나는 정보 없음.

## 5. 테스트 계획

- `kernel/holidays`: `getHolidayEventsInRange`가 범위·이름·날짜키(YYYY-MM-DD)·정렬을 정확히 반환(빈 결과 포함).
- `services/calendar`(서버 직무 필터): `job` 지정 시 해당 jobFunction의 ACTIVE 유저 이벤트만 반환(권한 스코프와 교집합); `job` 없음/`ALL`이면 전체; 빈 직무 집합이면 빈 결과. **반환 이벤트/`LeaveCalendarEvent`에 `jobFunction` 필드 없음**(D7).
- API 라우트: 응답이 `{ events, holidays, unsyncedYears }` 형태; **동기화를 호출하지 않음**(D8, read-only — `ensureYearsSynced` 미호출); 적재된 연도는 `unsyncedYears: []`, 미적재 연도는 그 연도가 `unsyncedYears`에 포함.
- API 라우트(입력 검증, D10): `end < start` → 400; 일수 상한 초과(`end - start > 46일`) → 400; 운영 창(`now ± MAX_ANCHOR_MONTHS`) 밖 → 400.
- API 라우트(`job` 검증): 화이트리스트(`DEVELOPER|CIVIL_RESPONSE|CONTENT_MANAGER`) 외 값 → 400; `ALL`/없음 → 무필터로 서비스 호출.
- API 라우트(실패 신호, F3): `getHolidayEventsInRange` 또는 `getUnsyncedYears`가 throw해도 `{ holidays: [], unsyncedYears: [] }`(깨끗한 빈 상태)를 **절대 만들지 않음** — 실패 시 `unsyncedYears`에 윈도우 전체 연도가 채워짐. (휴가 조회 실패는 기존대로 에러.)
- 어댑터: `holidaysToEvents`가 `kind=HOLIDAY`·half-open·status 없음으로 변환.
- 컴포넌트(`LeaveCalendar`): 직무 버튼 선택 시 `job` 파라미터로 **재요청**(서버가 필터한 결과를 그대로 표시) + 공휴일 유지, `전체`는 무필터. nav 우측·범례 정적. `unsyncedYears`가 비어있지 않으면 인라인 안내 표시, 빈/없음이면 미표시(D9).
- `kind-styles`: ANNUAL/HALF/QUARTER/HOLIDAY soft가 `text-*-700` 포함(변형 A) — 기존 색 단언 갱신.

## 6. 비범위·후속

- 통합 캘린더(`/calendar`)의 구글+연차 휴가 합산: 별도 설계.
- 직무 버튼 동적 생성(데이터 기반)·PM 버튼: 이번엔 고정 4버튼(D2)로 고정, 필요 시 후속.
- 외주/정규(employmentType) 필터: 연차 데이터는 사실상 외주만 존재하므로 추가하지 않음.
- **CONTRACTOR 강제(employmentType, 적대검증 F6)**: 연차 캘린더·신청 생성·admin은 현재 권한만으로 대상을 정하고 employmentType을 강제하지 않는다(pre-existing). §1의 '연차=외주 전용'은 **조직 정책일 뿐 코드 불변식이 아니다.** 정규직 연차 레코드가 유입되면 캘린더에 섞일 수 있음. 강제하려면 신청 생성·admin·조회를 아우르는 별도 작업이 필요 — 이번(표현계층) 범위 밖, **후속 과제로 기록**(사용자 확정: 기존 유지 + follow-up).
- **직무 필터 노출 범위(적대검증 F9)**: 직무 필터는 가시 범위 내 코워커의 coarse 직무를 버튼 순회로 추론 가능케 한다(오라클). 이번엔 외주 자체조회 목적상 권한 범위 내 전 사용자에게 노출(D7 수용). 직무를 비공개 속성으로 강화해야 하면, **필터 자체를 `leave.status:view`/admin 권한자에게만 노출**하도록 제한하는 후속 과제.
- **공휴일 자동 채움(durable sync-state)**: 미동기화 연도를 캘린더 조회 시 자동으로 채우려면, `Holiday`에 연도별 fetch 상태(lastAttempt/lastError/backoff)를 두고 read 경로에서 backoff 가드 하에 동기화하는 방식이 필요(통합 캘린더 `CalendarSource` TTL 패턴에 대응). 이번 범위는 read-only(D8)+신호(D9)로 한정하고, 자동 채움이 필요해지면 후속 설계로 분리(마이그레이션 동반).
