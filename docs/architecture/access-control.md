# Access Control Design

## 배경

`ops-hub` 사용자는 단순히 관리자/사용자로 나뉘지 않습니다.

초기 사용자 그룹:

| 구분 | 고용형태 | 직무 |
| --- | --- | --- |
| PM | 정규 | PM |
| 개발자 | 정규 | 개발 |
| 개발자 | 외주 | 개발 |
| 컨텐츠관리 | 외주 | 컨텐츠 관리 |
| 민원응대 | 외주 | 민원 응대 |

각 그룹은 메뉴 접근 권한뿐 아니라 같은 메뉴 안에서도 가능한 액션이 다를 수 있습니다.

예:

- 정규 개발자는 업무 설정을 볼 수 있지만 외주 개발자는 볼 수 없다.
- 외주 컨텐츠관리자는 주간보고 자료 입력은 가능하지만 발송은 불가하다.
- 민원응대 담당자는 알림톡 관련 화면은 볼 수 있지만 대금청구 설정은 불가하다.
- PM은 전체 메뉴와 감사 로그를 볼 수 있다.

## 설계 원칙

1. 사용자의 조직 속성과 권한을 분리한다.
2. 메뉴 표시 권한과 실제 API 실행 권한을 같은 permission으로 판단한다.
3. 역할은 여러 개 부여할 수 있다.
4. 예외 권한은 사용자별 override로 관리하되, 남발하지 않는다.
5. 중요한 권한 변경은 감사 로그로 남긴다.

## 모델 개요

```text
User
  employmentType: REGULAR | CONTRACTOR
  jobFunction: PM | DEVELOPER | CONTENT_MANAGER | CIVIL_RESPONSE
  systemRole: OWNER | ADMIN | MANAGER | MEMBER

AccessRole
  key: pm, regular-developer, contractor-developer, contractor-content, contractor-civil-response

Permission
  resource: workflows.billing
  action: send

RolePermission
  role -> permission
  effect: ALLOW | DENY
  scope: own | team | all | assigned
  conditions: optional Json

UserPermissionOverride
  user -> permission
  effect: ALLOW | DENY
  scope
  startsAt / endsAt

NavigationItem
  menu item -> required permission
```

## 사용자 속성

`employmentType`은 정규/외주 구분입니다.

```text
REGULAR
CONTRACTOR
```

`jobFunction`은 실제 직무입니다.

```text
PM
DEVELOPER
CONTENT_MANAGER
CIVIL_RESPONSE
```

이 값들은 권한 계산의 직접 조건으로도 쓸 수 있지만, 기본적으로는 초기 role 자동 부여와 화면 필터링에 사용합니다.

## systemRole

`systemRole`은 비상/최상위 성격의 coarse-grained 역할입니다.

| systemRole | 용도 |
| --- | --- |
| OWNER | PM 또는 시스템 소유자. 모든 권한 허용 |
| ADMIN | 사용자/설정 관리 가능 |
| MANAGER | 일부 관리 권한 가능 |
| MEMBER | 일반 사용자 |

세부 업무 권한은 `AccessRole`과 `Permission`으로 판단합니다.

## AccessRole

초기 기본 role:

| key | 대상 |
| --- | --- |
| `pm` | PM |
| `regular-developer` | 정규 개발자 |
| `contractor-developer` | 외주 개발자 |
| `contractor-content` | 외주 컨텐츠관리 |
| `contractor-civil-response` | 외주 민원응대 |

한 사용자는 여러 role을 가질 수 있습니다.

예:

```text
외주 개발자 + 민원응대 보조
  roles = contractor-developer, contractor-civil-response
```

## Permission 명명 규칙

권한은 `resource + action`으로 정의합니다.

권장 resource:

```text
dashboard
calendar.work
calendar.leave
calendar.personal
calendar.team
calendar.admin
workflows.weekly
workflows.billing
workflows.notification
leave.request
leave.approval
leave.allocation
admin.users
admin.settings
admin.audit
integrations.google
integrations.smtp
integrations.templates
```

권장 action:

```text
view
create
update
delete
approve
generate
review
send
configure
export
impersonate
```

예:

```text
workflows.weekly:view
workflows.weekly:generate
workflows.weekly:send
leave.approval:approve
admin.users:update
```

## Scope

같은 권한이라도 범위가 다를 수 있습니다.

| scope | 의미 |
| --- | --- |
| own | 본인 데이터 |
| team | 소속 팀/부서 데이터 |
| assigned | 배정된 작업 |
| all | 전체 |

예:

```text
leave.request:view scope=own
leave.approval:view scope=team
workflows.billing:send scope=all
```

## Conditions

`conditions`는 JSON으로 보관합니다. 처음부터 복잡한 policy engine을 만들지 않고, 필요한 조건만 명시적으로 해석합니다.

예:

```json
{
  "workflowKinds": ["WEEKLY_REPORT"],
  "employmentTypes": ["REGULAR"],
  "jobFunctions": ["DEVELOPER"]
}
```

조건이 복잡해지면 나중에 별도 policy evaluator로 분리합니다.

## 메뉴와 API 권한

메뉴는 `NavigationItem.requiredPermissionId`로 제어합니다.

중요한 점:

메뉴를 숨기는 것은 UX일 뿐이고, 실제 API도 같은 permission을 검사해야 합니다.

```text
UI menu visible?
  hasPermission(user, "workflows.billing", "view")

API send billing?
  requirePermission("workflows.billing", "send")
```

## Deny 우선순위

권한 계산 우선순위:

1. `systemRole=OWNER`이면 허용
2. 유효 기간 안의 `UserPermissionOverride DENY`가 있으면 거부
3. 유효 기간 안의 `UserPermissionOverride ALLOW`가 있으면 허용
4. 부여된 role의 `RolePermission DENY`가 있으면 거부
5. 부여된 role의 `RolePermission ALLOW`가 있으면 허용
6. 기본 거부

기본은 fail-closed입니다.

## 초기 권한 매트릭스 초안

| 기능 | PM | 정규 개발 | 외주 개발 | 외주 컨텐츠 | 외주 민원응대 |
| --- | --- | --- | --- | --- | --- |
| 대시보드 조회 | O | O | O | O | O |
| 업무 캘린더 조회 | 전체 | 팀/배정 | 배정 | 배정 | 배정 |
| 휴가/근태 캘린더 조회 | 전체 상세 | 팀 부재/본인 상세 | 배정 범위/본인 상세 | 배정 범위/본인 상세 | 배정 범위/본인 상세 |
| 개인 캘린더 조회 | 본인 | 본인 | 본인 | 본인 | 본인 |
| 캘린더 관리자 진단 | O | - | - | - | - |
| 주간보고 조회 | O | O | O | O | - |
| 주간보고 자료 입력 | O | O | O | O | - |
| 주간보고 생성 | O | O | 제한 | O | - |
| 주간보고 발송 | O | 제한 | - | - | - |
| 대금청구 조회 | O | 제한 | - | - | - |
| 대금청구 생성 | O | 제한 | - | - | - |
| 대금청구 발송 | O | - | - | - | - |
| 알림톡 조회 | O | O | O | O | O |
| 알림톡 자료 입력 | O | O | O | O | O |
| 알림톡 발송 | O | 제한 | - | - | 제한 |
| 내 연차 신청 | O | O | O | O | O |
| 연차 승인 | O | 제한 | - | - | - |
| 연차 할당 관리 | O | - | - | - | - |
| 사용자 관리 | O | - | - | - | - |
| 시스템 설정 | O | - | - | - | - |
| 감사 로그 | O | - | - | - | - |

`제한`은 초기 운영 정책 확정이 필요한 항목입니다.

## 구현 인터페이스 초안

서버에서 사용할 helper:

```typescript
await requirePermission(userId, "workflows.billing", "send", {
  scope: "all",
  target: { workflowTaskId },
});
```

클라이언트에서 사용할 hook:

```typescript
const canSendBilling = useCan("workflows.billing", "send");
```

권한 목록은 로그인 세션에 전부 넣지 않습니다. 세션에는 user id, systemRole, employmentType, jobFunction 정도만 넣고, 메뉴 렌더링에 필요한 permission summary는 별도 API로 조회합니다.

## 관리 UI

초기 관리자 화면:

```text
/admin/users
  사용자 기본 정보
  고용형태
  직무
  systemRole
  access roles

/admin/roles
  role 목록
  permission matrix

/admin/permissions
  permission catalog

/admin/audit
  권한 변경 이력
```

## 남은 결정

- PM 한 명만 `OWNER`인지, 복수 OWNER를 허용할지
- 정규 개발자에게 대금청구 생성 권한을 줄지
- 외주 개발자의 주간보고 생성 권한 범위
- 민원응대 담당자의 알림톡 발송 권한 범위
- 부서/팀 개념을 `department` 문자열로 충분히 둘지, `Team` 모델을 추가할지
