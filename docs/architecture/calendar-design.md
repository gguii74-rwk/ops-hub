# 통합 캘린더 설계

## 배경

현재 캘린더와 연차 정보의 출처가 나뉘어 있습니다.

- `annual-leave` 캘린더는 연차 시스템에서 신청한 외주직원의 근태만 보여준다.
- `day-sync` 캘린더는 Google Calendar와 연동되어 정직원/외주직원의 휴가, 개인 일정, 업무 일정을 함께 보여준다.
- 통합 후에는 연차 신청과 휴가 표시가 같은 기준으로 관리되어야 하며, 업무 캘린더는 권한에 따라 다른 수준의 정보를 보여줘야 한다.

따라서 `ops-hub`의 캘린더는 단일 화면 기능이 아니라 여러 출처를 합성하는 도메인으로 설계합니다.

## 출처별 권위

| 출처 | 권위 | 용도 |
| --- | --- | --- |
| `LeaveRequest` | 휴가/근태의 기준 데이터 | 신청, 승인, 잔여 연차, 휴가 표시 |
| `WorkflowTask` | 업무 일정의 기준 데이터 | 주간보고, 대금청구, 알림톡 보고서 작업 |
| Google Calendar | 외부 일정/전환기 보조 데이터 | 기존 휴가 일정, 개인/팀 외부 일정, 회의 |
| 공휴일 캘린더 | 외부 기준 데이터 | 공휴일 표시와 영업일 계산 |
| 수동 일정 | 보조 데이터 | 팀 공지, 임시 마일스톤 |

원칙:

- `ops-hub` 도입 이후 새 휴가는 `LeaveRequest`가 기준입니다.
- Google Calendar에 있는 휴가성 일정은 전환기 동안만 함께 보여주고, 내부 승인 휴가와 겹치면 내부 휴가가 우선합니다.
- 업무 일정은 `WorkflowTask`에서 생성하고, 필요하면 CalendarEvent로 색인해 빠르게 조회합니다.
- Google Calendar로 승인 휴가를 다시 써주는 write-back은 초기 범위에서 제외하고, 필요성이 검증된 뒤 추가합니다.

## 이벤트 분류

`CalendarEvent.kind`는 표시 정책과 중복 제거 기준을 나누기 위한 분류입니다.

| 종류 | 설명 |
| --- | --- |
| `WORKFLOW_TASK` | 업무 자동화 작업 일정 |
| `INTERNAL_LEAVE` | `LeaveRequest`에서 생성된 휴가/근태 일정 |
| `EXTERNAL_VACATION` | Google Calendar에서 가져온 휴가성 일정 |
| `EXTERNAL_EVENT` | Google Calendar의 일반 외부 일정 |
| `HOLIDAY` | 공휴일 |
| `PERSONAL_EVENT` | 개인 전용 일정 |
| `TEAM_EVENT` | 팀 공유 일정 |

## 캘린더 뷰

초기 UI는 하나의 만능 캘린더가 아니라 목적별 뷰로 나눕니다.

| 뷰 | 목적 | 기본 표시 |
| --- | --- | --- |
| 업무 캘린더 | 반복 업무와 제출/발송 일정 관리 | `WORKFLOW_TASK`, 관련 팀 일정, 제한된 휴가 배지 |
| 휴가/근태 캘린더 | 연차 신청, 승인, 팀 부재 확인 | `INTERNAL_LEAVE`, 전환기 `EXTERNAL_VACATION`, 공휴일 |
| 개인 캘린더 | 본인 업무, 본인 휴가, 본인 외부 일정 | 본인 이벤트 전체와 권한 허용 팀 이벤트 |
| 팀 캘린더 | 팀 단위 업무와 부재 공유 | 팀 업무 일정, 팀원의 휴가/부재 요약 |
| 관리자 캘린더 | 데이터 진단과 운영 관리 | 전체 출처, 중복 상태, 동기화 상태 |

API는 같은 이벤트 저장소에서 권한과 뷰에 맞춰 다른 응답을 만듭니다.

```text
GET /api/calendar/feed?view=work|leave|personal|team|admin&start&end&teamId?
```

응답에는 이벤트뿐 아니라 출처 상태를 포함합니다.

```text
events[]
sources[]
staleSources[]
failedSources[]
```

## 권한별 표시 정책

캘린더는 메뉴 접근 권한과 별도로 이벤트 필드 단위 마스킹이 필요합니다.

| 사용자 | 업무 캘린더 | 휴가/근태 캘린더 | 개인/팀 정보 |
| --- | --- | --- | --- |
| PM/OWNER | 전체 업무, 전체 휴가, 외부 소스 진단 | 신청 사유와 승인 상태 포함 | 전체 표시 |
| 개발자 정직 | 본인/팀 업무 중심 | 팀 부재와 본인 상세 | 타인 사유는 기본 숨김 |
| 개발자 외주 | 본인 업무와 배정된 팀 업무 | 본인 상세, 팀 부재 요약 | 타인 상세 숨김 |
| 컨텐츠관리 외주 | 관련 업무 일정 | 본인 상세, 필요한 부재 요약 | 담당 범위 외 숨김 |
| 민원응대 외주 | 관련 업무 일정 | 본인 상세, 필요한 부재 요약 | 담당 범위 외 숨김 |

마스킹 원칙:

- 권한이 없으면 제목은 `휴가`, `부재`, `외부 일정`처럼 요약 제목으로 대체합니다.
- 휴가 사유, 개인 일정 제목, 외부 캘린더 설명은 기본적으로 비공개입니다.
- PM/OWNER와 명시 권한이 있는 관리자만 전체 상세를 봅니다.
- API와 UI가 같은 permission key를 사용해 메뉴 노출과 데이터 노출이 어긋나지 않게 합니다.

## 중복 제거

전환기에는 같은 휴가가 `LeaveRequest`와 Google Calendar에 동시에 존재할 수 있습니다.

중복 판단 기준:

- 동일 사용자로 매핑된 Google Calendar 이벤트가 내부 승인 휴가와 날짜 범위가 겹친다.
- Google Calendar 제목이 휴가/연차/반차/오전반차/오후반차 같은 휴가성 키워드를 포함한다.
- all-day 이벤트 또는 근무시간 대부분을 차지하는 이벤트다.

처리:

- 내부 휴가가 있으면 `INTERNAL_LEAVE`만 기본 표시합니다.
- 외부 이벤트는 `DUPLICATE_OF_INTERNAL`로 남겨 관리자 뷰에서 진단할 수 있게 합니다.
- 사용자 매핑이 안 된 외부 휴가는 `EXTERNAL_VACATION`으로 표시하되 상세는 제한합니다.
- 전환 완료 후 Google Calendar 휴가 입력을 금지하거나 숨김 처리할지 결정합니다.

## 캐시와 동기화

초기 성능 문제는 Google Calendar를 화면 전환마다 다시 조회하는 데서 발생합니다. `ops-hub`에서는 DB 캐시를 기본으로 둡니다.

| 대상 | 캐시 |
| --- | --- |
| 공휴일 | DB 캐시 24시간 |
| Google Calendar | DB 캐시 5~15분, stale-while-revalidate |
| 업무/연차 | PostgreSQL 직접 조회와 인덱스 |
| 브라우저 | React Query 또는 SWR stale cache |

동기화 정책:

- `CalendarSource`는 캘린더별 상태, TTL, 외부 ID, 소유자를 가진다.
- `CalendarCacheEntry`는 조회 범위별 원본 payload와 만료 시간을 저장한다.
- 외부 API 실패 시 마지막 정상 캐시를 보여주고 `failedSources`로 표시한다.
- 관리자 화면에서 수동 새로고침과 마지막 동기화 오류를 확인할 수 있게 한다.

## 구현 순서

1. `CalendarSource`, `CalendarEvent`, `CalendarCacheEntry` 모델을 먼저 둔다.
2. `LeaveRequest` 승인/취소 시 `INTERNAL_LEAVE` 이벤트를 생성하거나 갱신한다.
3. `WorkflowTask` 생성/일정 변경 시 `WORKFLOW_TASK` 이벤트를 생성하거나 갱신한다.
4. Google Calendar 동기화 잡이 외부 이벤트를 DB 캐시에 저장한다.
5. feed API에서 뷰, 기간, 권한에 따라 이벤트를 합성하고 마스킹한다.
6. 관리자 뷰에서 중복/오류/오래된 소스를 진단한다.
