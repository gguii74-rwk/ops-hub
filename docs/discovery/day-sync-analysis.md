# day-sync 분석

## 요약

`day-sync`는 `ops-hub`의 주된 기반으로 삼을 만합니다. Next.js App Router, Route Handler -> Service -> Repository -> Prisma 구조, 문서 생성/메일 발송/Google 연동이 이미 검증되어 있습니다.

다만 현재 코드는 POC에서 운영으로 빠르게 넘어온 흔적이 있습니다.

- 설정이 `.env`, 코드 상수, DB, 템플릿 경로, 배포 문서에 흩어져 있다.
- 인증은 NextAuth Credentials가 있으나 보호 범위와 권한 모델이 부족하다.
- 캘린더는 매 화면 전환마다 API를 다시 호출하고 Google Calendar 캐시가 부족하다.
- 업무 상태와 발송 단계가 문자열 중심이라 고도화 시 상태 전이가 불명확해질 수 있다.
- UI는 기능 중심으로 충분히 동작하지만, 반복 업무용 정보 구조와 피드백이 더 필요하다.

## 현재 구조

주요 스택:

- Next.js 16 App Router
- React 19
- Prisma 6 + SQLite
- NextAuth v5 Credentials
- FullCalendar
- Google Sheets/Calendar API
- Nodemailer
- LibreOffice headless
- ExcelJS, JSZip

계층 구조:

```text
Route Handler -> Service -> Repository -> Prisma
```

주요 업무 도메인:

- `TaskType`, `Task`: 주간보고, 대금청구, 알림톡 작업
- `BillingConfig`, `BillingRoundDate`: 대금청구 설정
- `Deliverable`: 주간보고 산출물 진행 현황
- 파일 생성/미리보기/메일 발송 로직

## 가져갈 것

### 1. 계층 구조

현재의 `src/services`, `src/repositories`, `src/lib`, `src/app/api` 분리는 `ops-hub`에서도 유지할 가치가 있습니다.

다만 모듈이 늘어나면 루트에 모든 service/repository가 쌓이기보다 다음처럼 도메인별로 묶는 편이 좋습니다.

```text
src/modules/workflows/
  services/
  repositories/
  validations/
  routes 또는 route handlers

src/modules/leave/
src/modules/admin/
src/modules/integrations/
```

### 2. 문서 생성 경험

`day-sync`의 가장 큰 자산은 업무 문서 자동 생성입니다.

- 주간보고 XLSX 생성/미리보기/수정
- 대금청구 HWPX 생성
- 알림톡 보고서 HWPX/XLSX/PDF 생성
- LibreOffice PDF 변환
- 메일 발송 단계 관리

이 로직은 `ops-hub`에서 `workflows` 모듈로 포팅합니다.

### 3. 배포 구조

`day-sync`는 이미 `kgs-dev`에서 운영 구조가 잡혀 있습니다.

```text
/home/daysync/apps/day-sync/
  current -> releases/<release-id>
  shared/
    prod.db
    Template/
    keys/
    output -> /NAS/day-sync/output
    backups -> /NAS/day-sync/backups
```

`ops-hub`도 release/shared 구조를 유지하되, DB는 PostgreSQL로 옮깁니다.

## 버릴 것 또는 바꿀 것

### 1. SQLite

고도화된 내부 업무 허브에서는 PostgreSQL을 사용합니다.

이유:

- 연차 승인/업무 발송/감사 로그를 한 DB에서 관리해야 한다.
- JSON, enum, decimal, bigint, index를 더 명확하게 쓸 수 있다.
- 백업/복구/권한 분리/마이그레이션이 더 안정적이다.

### 2. 문자열 JSON 저장

현재 `Task.recipients`, `TaskType.defaultRecipients`는 문자열 JSON입니다.

`ops-hub`에서는 PostgreSQL `Json` 컬럼으로 옮깁니다.

### 3. 설정의 코드/환경변수 혼재

현재 설정 출처가 여러 곳입니다.

| 설정 | 현재 위치 |
| --- | --- |
| DB/Auth | `.env`, `env-validation.ts` |
| Google Calendar 목록 | `GOOGLE_CALENDARS` JSON env |
| Google Sheets ID | env |
| SMTP | env |
| LibreOffice | env |
| 템플릿 경로 | DB `TaskType.templatePath`, 코드 상수 |
| output 경로 | 코드 상수, 배포 shared symlink |
| 청구 연도별 설정 | DB |
| 기본 수신자 | DB 문자열 JSON |

`ops-hub`에서는 설정을 세 층으로 나눕니다.

```text
Runtime env: DB URL, auth secret, external secret path
DB settings: 업무별 수신자, 캘린더 목록, 템플릿 매핑, 청구 설정
Server filesystem: Template, output, keys
```

### 4. 얇은 인증/권한

NextAuth는 있으나 보호 범위가 제한적입니다.

현재 보호:

- `/dashboard`
- `/tasks`
- `/api` 전체, 단 `/api/auth` 제외

문제:

- `/settings/billing` 같은 설정 페이지 보호가 matcher에 명시되어 있지 않다.
- 역할별 화면/행동 제한이 충분히 분리되어 있지 않다.
- 관리자/일반 사용자 UX가 명확하지 않다.
- 감사 로그가 없다.

`ops-hub`에서는 다음을 기본으로 둡니다.

- 모든 업무 화면은 인증 필수
- 모든 API는 인증 필수, 공개 API는 명시적으로 allowlist
- `ADMIN`, `MANAGER`, `MEMBER` 역할 도입
- 주요 변경은 `AuditLog`에 기록

## 캘린더 성능 분석

현재 캘린더 로딩 흐름:

```text
FullCalendar datesSet
  -> GET /api/tasks?start&end
  -> GET /api/calendar?start&end
       -> getHolidays(start,end)
       -> getPersonalEvents(configs,start,end)
```

현재 캐시:

- 공휴일만 서버 메모리 Map으로 24시간 캐시
- 개인 Google Calendar 이벤트는 캐시 없음
- 업무 task는 캐시 없음
- 브라우저/서버 fetch cache 없음
- DB 캐시 테이블 없음

문제:

- 월 이동, 주/월 보기 전환 때 Google Calendar API를 반복 호출한다.
- configured calendar 수가 많을수록 `Promise.allSettled` 비용이 커진다.
- `refreshKey`로 캘린더 컴포넌트 전체 remount가 발생한다.
- `/api/tasks`와 `/api/calendar`가 분리되어 브라우저 왕복이 늘어난다.
- 화면에는 skeleton/부분 로딩보다 전체 로딩 체감이 크다.
- Google Calendar에 등록된 정직/외주 휴가와 연차 시스템의 외주직원 휴가가 별도 출처로 존재해 통합 시 중복 표시 가능성이 있다.

## 캘린더 고도화 설계

`ops-hub`에서는 캘린더를 출처별로 합친 뒤, 뷰와 권한에 따라 다시 나눠 보여줍니다.

- 휴가/근태 기준 데이터는 `LeaveRequest`로 둔다.
- Google Calendar 휴가성 일정은 전환기 외부 데이터로 가져오고, 내부 휴가와 겹치면 내부 휴가를 우선 표시한다.
- day-sync의 기존 캘린더는 업무 중심 뷰로 재정의한다.
- 개인/팀/관리자 캘린더는 같은 feed API를 사용하되 표시 범위와 마스킹 수준을 다르게 둔다.

### 1단계: 서버 메모리 캐시 확장

개인 캘린더도 월 단위로 짧게 캐시합니다.

```text
key = calendarId + yyyy-mm
ttl = 5~15분
```

특징:

- 구현이 간단하다.
- 단일 프로세스에서는 효과가 크다.
- 배포/restart 시 캐시가 사라진다.

### 2단계: DB 캐시 테이블

PostgreSQL에 외부 캘린더 조회 결과를 저장합니다.

```text
ExternalCalendarCache
  provider
  calendarId
  rangeStart
  rangeEnd
  payload Json
  fetchedAt
  expiresAt
```

장점:

- 프로세스 재시작에도 유지된다.
- 여러 인스턴스에서도 공유 가능하다.
- 수동 새로고침과 stale-while-revalidate를 구현할 수 있다.

### 3단계: 통합 calendar feed API

프론트에서는 하나의 API만 호출합니다.

```text
GET /api/calendar/feed?start=...&end=...

response:
  events[]
  sources[]
  staleSources[]
  failedSources[]
```

장점:

- 화면 로딩을 단순화한다.
- 부분 실패를 표시하기 쉽다.
- `ops-hub`에서 업무 일정, 연차 일정, 외부 일정을 같은 모델로 합성할 수 있다.
- 업무 캘린더와 휴가/근태 캘린더를 분리해 목적별 화면 밀도를 낮출 수 있다.

### 4단계: 클라이언트 캐시

React Query 또는 SWR을 도입합니다.

권장:

- `staleTime`: 1~5분
- `keepPreviousData`: 월 이동 시 이전 달 표시 유지
- 수동 새로고침 버튼
- 캘린더 소스별 로딩/실패 배지

## UI/UX 개선 과제

### 네비게이션

현재 `day-sync`는 캘린더 중심 단일 대시보드에 기능 버튼이 붙어 있습니다.

`ops-hub`에서는 반복 업무용 좌측 내비게이션 또는 상단 탭이 필요합니다.

```text
Dashboard
Workflows
  Weekly Report
  Billing
  Notification Billing
Leave
  My Leave
  Team Calendar
  Approvals
Admin
  Users
  Settings
```

### 설정 화면

현재 설정은 업무별로 흩어져 있습니다.

개선:

- 설정 홈
- 연동 상태 카드
- Google Calendar 목록 관리
- SMTP 테스트 발송
- 템플릿 경로 검증
- LibreOffice 경로 검증
- 기본 수신자 관리
- 청구 연도별 설정

### 작업 상세

현재 작업 상태는 기능적으로 동작하지만, 단계형 업무에는 timeline이 더 적합합니다.

예:

```text
생성 전 -> 문서 생성 -> 검토 -> 1차 발송 -> 본사 요청 -> 최종 발송
```

각 단계에 다음 정보를 붙입니다.

- 수행자
- 수행 시각
- 생성 파일
- 메일 수신자
- 오류
- 재시도 버튼

### 오류와 재시도

외부 연동이 많으므로 실패 UX가 중요합니다.

- Google API 실패: 어느 calendar/source가 실패했는지 표시
- PDF 변환 실패: LibreOffice 경로/timeout 표시
- 메일 실패: SMTP 연결/첨부 용량/수신자 오류 분리
- 문서 생성 실패: 템플릿 누락/치환 토큰 누락 분리

## ops-hub 반영 우선순위

1. PostgreSQL 스키마와 공통 인증/권한
2. 설정 registry 설계
3. calendar feed API와 캐시 설계
4. workflows 도메인 포팅
5. 파일/메일/문서 생성 이력화
6. UI 정보구조 재설계
