# annual-leave 분석

## 요약

`annual-leave`는 연차 도메인 규칙이 잘 축적되어 있지만, 구현 방식은 `ops-hub`에 직접 병합하지 않는 편이 좋습니다.

가져갈 것은 업무 규칙과 데이터 모델입니다.

버릴 것은 다음입니다.

- Express 별도 백엔드
- JWT/localStorage 인증
- 프론트의 API URL 하드코딩
- PM2 중심 배포 방식
- SQLite 파일 DB

## 현재 구조

스택:

- Frontend: Next.js 14, React 18, Zustand, Axios
- Backend: Express, TypeScript, Prisma, SQLite
- Auth: JWT + bcrypt
- Email: Nodemailer
- Deployment: PM2, frontend/backend 분리

주요 API:

- `/api/auth`
- `/api/allocations`
- `/api/leave-requests`
- `/api/calendar`
- `/api/reports`
- `/api/settings`

## 핵심 도메인

### User

연차 시스템의 사용자는 직원과 관리자로 나뉩니다.

주요 필드:

- email
- password
- name
- department
- position
- joinDate
- role
- isActive
- accountStatus

`ops-hub`에서는 `User` 공통 모델로 흡수합니다.

역할 매핑:

| annual-leave | ops-hub |
| --- | --- |
| ADMIN | ADMIN |
| EMPLOYEE | MEMBER |

추후 부서장/팀장 승인 흐름이 필요하면 `MANAGER`를 추가 매핑합니다.

### LeaveAllocation

연도별 연차 할당입니다.

주요 규칙:

- 사용자 + 연도는 unique
- 기본 연차, 이월 연차, 이월 만료일, 사용 연차를 관리
- 대기 중인 신청은 잔여 계산에서 차감

`ops-hub`에서는 Decimal 타입을 사용합니다.

### LeaveRequest

연차 신청입니다.

지원 유형:

- `ANNUAL`: 1일 이상
- `HALF`: 오전/오후 반차
- `QUARTER`: 0.25일 단위 반반차

상태:

- `PENDING`
- `APPROVED`
- `REJECTED`
- `CANCELLED`

주요 규칙:

- 일반 사용자는 과거 날짜 신청 불가
- 관리자는 과거 날짜 직접 입력 가능
- 같은 기간의 `PENDING`, `APPROVED` 신청과 중복 불가
- 승인 시 사용 연차 증가
- 승인된 연차 취소 시 사용 연차 감소
- 사용 당일 또는 과거 연차는 일반 사용자가 취소 불가

### LeaveAllocationHistory

연차 조정 이력입니다.

가져갈 규칙:

- 조정 전/후 잔여 일수 기록
- 조정 사유와 상세 사유 기록
- 조정자 기록

## 발견한 구현상 주의점

### 1. 인증 구조

현재 백엔드는 JWT를 `Authorization` header에서 읽고, 프론트는 localStorage의 token을 Axios interceptor로 붙입니다.

`ops-hub`에서는 NextAuth 세션 기반으로 바꿉니다.

이유:

- `day-sync`와 통합하려면 인증 체계를 하나로 맞춰야 한다.
- localStorage token은 XSS에 취약하다.
- API Route와 서버 컴포넌트에서 세션 확인을 일관되게 처리하는 편이 낫다.

### 2. API URL 하드코딩

프론트 API 클라이언트가 접속 hostname에 따라 API URL을 직접 분기합니다.

예:

- 공인 IP
- 내부 IP
- localhost

`ops-hub`에서는 이런 분기를 제거하고 same-origin API Route를 사용합니다.

```text
frontend -> /api/leave/*
```

### 3. 연차 사용일수 동기화

현재 승인/취소 시 `LeaveAllocation.usedDays`를 업데이트합니다.

장점:

- 조회가 빠르다.

주의점:

- 승인/취소/관리자 수정/삭제가 모두 같은 불변식을 지켜야 한다.
- 장애 또는 수동 DB 수정 시 `usedDays`가 실제 승인 내역과 불일치할 수 있다.

`ops-hub`에서는 두 방법 중 하나를 명확히 선택해야 합니다.

권장:

- `usedDays`는 캐시 필드로 유지한다.
- 승인/취소/수정/삭제는 반드시 transaction으로 처리한다.
- 관리자용 `recalculate leave usage` 작업을 만든다.

### 4. 메일 발송

연차 신청/승인/반려 메일은 업무 성공과 분리되어 background로 처리됩니다.

이 접근은 유지할 수 있지만, `ops-hub`에서는 `MailDelivery` 이력으로 남기는 것이 좋습니다.

### 5. 캘린더 UI

현재 연차 캘린더는 직접 grid를 렌더링합니다.

문제:

- 많은 인원이 동시에 휴가를 쓰면 날짜 cell이 복잡해진다.
- 월간 캘린더와 목록이 같은 화면에 길게 이어진다.
- 필터링은 클라이언트 중심이고, 부서/사용자 목록을 별도 API로 가져온다.

`ops-hub`에서는 업무 캘린더와 같은 feed API로 합치는 편이 좋습니다.

## ops-hub로 포팅할 기능

1. 사용자별 연차 요약
2. 연차 신청
3. 관리자 승인/반려
4. 관리자 직접 입력
5. 관리자 수정/삭제
6. 연도별 연차 할당
7. 연차 조정 이력
8. 부서/사용자 필터 캘린더
9. 연차 엑셀 리포트
10. 연차 알림 메일

## 새 설계 제안

### API

```text
GET    /api/leave/summary
GET    /api/leave/requests
POST   /api/leave/requests
PATCH  /api/leave/requests/:id/cancel

GET    /api/admin/leave/requests
POST   /api/admin/leave/requests
PATCH  /api/admin/leave/requests/:id
PATCH  /api/admin/leave/requests/:id/approve
PATCH  /api/admin/leave/requests/:id/reject
DELETE /api/admin/leave/requests/:id

GET    /api/admin/leave/allocations
PUT    /api/admin/leave/allocations/:userId/:year
POST   /api/admin/leave/allocations/:userId/:year/adjust
```

### UI

```text
/leave
  내 연차 요약
  신청 버튼
  신청 이력

/leave/calendar
  팀/전체 캘린더

/admin/leave/approvals
  승인 대기

/admin/leave/allocations
  연도별 할당 관리
```

## 우선 분석 과제

- 연차 산정 규칙이 회사 규정과 맞는지 확인
- 반반차 시간대가 고정인지 설정 가능한지 확인
- 이월 연차 만료일 처리 방식 확정
- 승인자 모델을 role 기반으로 둘지, 부서별 manager로 둘지 확정
- 기존 `usedDays`와 승인 내역의 정합성 검증 스크립트 작성

