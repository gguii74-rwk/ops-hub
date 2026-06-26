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

- **D1. 직무 필터 = 클라이언트 토글.** 응답 이벤트에 `jobFunction`을 동봉하고, 버튼 선택 시 클라이언트에서 즉시 필터(서버 재요청 없음). 연차 캘린더가 이미 쓰는 범례 토글과 같은 방식. 단일 선택(라디오) — 기본값 `전체`.
- **D2. 직무 버튼 = 고정 4개**: `전체 / 개발(DEVELOPER) / 민원(CIVIL_RESPONSE) / 콘텐츠(CONTENT_MANAGER)`. PM은 제외(외주에 사실상 없음). PM 직무 인원이 데이터에 있어도 `전체`에서는 보이되 단독 필터 버튼은 없음.
- **D3. 종류별 토글 필터 제거.** 기존 `CalendarMonth` 내부 kind 토글(연차/반차/반반차 클릭 숨김)을 끄고(`legend={false}`), 범례를 **정적 색 안내**로 전환한다. 필터 역할은 직무 필터가 담당.
- **D4. 범례 변형 A 스타일** = 채운 pill + 얇은 테두리 + **글자색 700**(각 색의 진한 톤). `대기중`=주황 배경·진한 노랑 점선, `반려/취소`=취소선. 공휴일=붉은색(rose).
- **D5. 공휴일은 직무와 무관하게 항상 표시.** 직무 필터를 어떤 값으로 두어도 공휴일은 남는다(`kind === "HOLIDAY"`는 필터 예외).
- **D6. 공휴일은 별도 응답 필드로 전달.** API 응답을 `{ events, holidays }`로 확장한다. 휴가 전용 필드(`leaveType`/`status`/`isSelf` 등)를 공휴일에 억지로 채우지 않기 위함. 클라이언트가 각각 공통 이벤트 모델로 변환.
- **D7. 권한·마스킹은 기존 정책 유지.** 이름·유형은 이미 공개, 사유·세부는 admin 외 마스킹(`getLeaveCalendar` line 104). `jobFunction`은 이름과 동급의 공개 정보로 보고 **마스킹하지 않는다**(마스킹돼도 직무 필터가 동작해야 하므로). 직무 필터는 뷰어가 **이미 볼 수 있는 데이터 범위 안에서만** 거른다(일반 사용자=본인+같은 팀, admin=전체).

## 3. 변경 상세 (계층별)

### 3.1 공휴일 조회 — `src/kernel/holidays/index.ts`
- 신규 `getHolidayEventsInRange(start, end): Promise<{ date: string; name: string }[]>` 추가.
  - `prisma.holiday.findMany({ where: { date: { gte, lte } }, select: { date, name }, orderBy: { date: "asc" } })`
  - `date`는 `"YYYY-MM-DD"`(UTC, 기존 `getHolidaysInRange`와 동일 규칙)로 변환.
- 기존 `getHolidaysInRange`(Set, 신청 검증용)는 **그대로 둔다**(소비처: 신청 fail-closed 게이트).

### 3.2 휴가 조회 서비스 — `src/modules/leave/services/calendar.ts`
- `LeaveCalendarEvent`에 `jobFunction: JobFunction` 추가.
- 이름 조회 쿼리(line 96)의 `select`에 `jobFunction: true` 추가, 결과 매핑에 `jobFunction` 포함.
- 마스킹 분기와 무관하게 `jobFunction`은 항상 채운다(D7).

### 3.3 API 라우트 — `src/app/api/leave/calendar/route.ts`
- `getLeaveCalendar(...)` 호출 후 `getHolidayEventsInRange(start, end)`를 호출.
- 응답을 `{ events, holidays }`로 변경(기존 `{ events }`에서 확장).
- 공휴일 조회 실패가 화면 전체를 막지 않도록, 공휴일은 best-effort(실패 시 빈 배열)로 감싼다. (휴가 조회 실패는 기존대로 에러.)

### 3.4 어댑터 — `src/app/(app)/leave/_components/leave-adapter.ts`
- `Ev` 인터페이스에 `jobFunction: string` 추가(API 응답 매칭).
- 신규 `holidaysToEvents(hs: { date: string; name: string }[]): CalendarEventInput[]`
  - `kind: "HOLIDAY"`, `title: name`, `allDay`, half-open(`allDayHalfOpen`) 단일 날짜, `status` 없음.
  - `id: "holiday:" + date`.
- `CalendarEventInput`(공용 타입)은 **건드리지 않는다** — `jobFunction`은 원본 `Ev`에서만 사용하고, 필터링을 어댑터 변환 전에 수행.

### 3.5 컴포넌트 — `src/app/(app)/leave/_components/leave-calendar.tsx`
- **상태**: `selectedJob: "ALL" | JobFunction`(기본 `"ALL"`).
- **직무 필터링**(어댑터 변환 전, 원본 `Ev[]`에서):
  ```
  const leaveRows = selectedJob === "ALL"
    ? (data?.events ?? [])
    : (data?.events ?? []).filter(e => e.jobFunction === selectedJob);
  const events = [...leaveToEvents(leaveRows), ...holidaysToEvents(data?.holidays ?? [])];
  ```
  공휴일은 직무 필터를 거치지 않으므로 항상 포함(D5).
- **툴바 레이아웃**: 좌측 직무 버튼(전체/개발/민원/콘텐츠) + 년월, 우측에 이전/오늘/다음(`ml-auto`). 새로고침 버튼 없음.
- **범례**: `CalendarMonth`의 `legend`를 끄고(D3), 변형 A 정적 범례를 직접 렌더(공휴일·연차·반차·반반차·대기중·반려/취소). 직무 버튼은 4개 고정이므로 라벨/값(`{ value: "ALL"|JobFunction, label }`)을 컴포넌트 내 상수로 인라인 정의(`admin/users/_components/labels.ts`의 `JOB_LABEL`은 admin 전용 private 영역이라 직접 import하지 않음).
- 기존 상단 상태 키 줄(이전 작업에서 추가한 대기중/반려)은 변형 A 범례에 흡수되어 제거.

### 3.6 칩 색 — `src/modules/calendar/ui/kind-styles.ts`
- 연차 캘린더가 쓰는 kind(`ANNUAL/HALF/QUARTER/HOLIDAY`)의 **soft 글자색을 950 → 700**으로 조정(변형 A). 배경 100·테두리(ring 또는 border) 유지.
- `HOLIDAY`는 통합 캘린더도 공유 → 통합 캘린더 팝오버의 공휴일 글자색도 700이 됨(무해, 일관).
- 통합 캘린더 전용 kind(`INTERNAL_LEAVE`/`WORKFLOW_TASK`/`EXTERNAL_*`/`PERSONAL`/`TEAM`)는 **이번에 건드리지 않는다**(범위 밖).
- `statusOverlay`(PENDING/REJECTED/CANCELLED)는 직전 작업 결과 그대로 유지.

### 3.7 범례 라벨
- 변형 A 정적 범례를 직접 렌더하므로 `legendLabel`은 불필요해질 수 있음. 정적 범례 칩에 한국어 라벨(공휴일/연차/반차/반반차/대기중/반려·취소)을 직접 기재.

## 4. 데이터·권한

- 직무 필터는 **표시 필터**일 뿐 권한 경계가 아니다. 서버는 기존 권한대로 데이터를 좁혀 반환하고(일반=본인+같은 팀 APPROVED, status:view=전 팀 APPROVED, admin=전체·전 상태), 클라이언트가 그 안에서 직무로 거른다.
- `jobFunction` 노출 범위 = 이름 노출 범위와 동일(이미 모든 반환 이벤트에 이름이 실림). 추가 정보 유출 없음.

## 5. 테스트 계획

- `kernel/holidays`: `getHolidayEventsInRange`가 범위·이름·날짜키(YYYY-MM-DD)·정렬을 정확히 반환(빈 결과 포함).
- `services/calendar`: 반환 이벤트에 `jobFunction` 포함, 마스킹 분기와 무관하게 채워짐.
- API 라우트: 응답이 `{ events, holidays }` 형태, 공휴일 조회 실패 시 `holidays: []`로 graceful.
- 어댑터: `holidaysToEvents`가 `kind=HOLIDAY`·half-open·status 없음으로 변환.
- 컴포넌트(`LeaveCalendar`): 직무 버튼 선택 시 해당 직무 휴가만 + 공휴일 유지, `전체`는 모두 표시. nav 우측·범례 정적.
- `kind-styles`: ANNUAL/HALF/QUARTER/HOLIDAY soft가 `text-*-700` 포함(변형 A) — 기존 색 단언 갱신.

## 6. 비범위·후속

- 통합 캘린더(`/calendar`)의 구글+연차 휴가 합산: 별도 설계.
- 직무 버튼 동적 생성(데이터 기반)·PM 버튼: 이번엔 고정 4버튼(D2)로 고정, 필요 시 후속.
- 외주/정규(employmentType) 필터: 연차 데이터는 사실상 외주만 존재하므로 추가하지 않음.
