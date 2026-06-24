# ADR-0002: 속성 기반 사용자 분류와 역할/권한 테이블

## 상태

Accepted

## 배경

`ops-hub`의 사용자는 PM, 정규 개발자, 외주 개발자, 외주 컨텐츠관리, 외주 민원응대 담당자로 구성됩니다.

권한은 단순 메뉴 표시 여부로 끝나지 않습니다.

- 메뉴 안의 생성/수정/발송/승인 액션이 다를 수 있다.
- 외주/정규 여부에 따라 같은 직무라도 권한이 달라질 수 있다.
- 특정 사용자에게 임시 예외 권한을 줄 수 있어야 한다.

기존 `ADMIN`, `MANAGER`, `MEMBER` enum만으로는 이 요구사항을 표현하기 어렵습니다.

## 결정

사용자 속성과 권한을 분리합니다.

- `User.employmentType`: 정규/외주
- `User.jobFunction`: PM/개발/컨텐츠관리/민원응대
- `User.systemRole`: OWNER/ADMIN/MANAGER/MEMBER
- `AccessRole`: 업무 역할
- `Permission`: resource/action 권한
- `RolePermission`: 역할별 권한
- `UserPermissionOverride`: 사용자별 예외 권한
- `NavigationItem`: 메뉴 표시와 permission 연결

권한 계산은 deny 우선, 기본 거부로 처리합니다.

## 결과

장점:

- 메뉴별 권한과 API 액션 권한을 같은 모델로 관리할 수 있다.
- 외주/정규와 직무를 별도 속성으로 보관해 검색/필터/정책에 활용할 수 있다.
- role 여러 개 부여와 사용자별 예외 권한이 가능하다.
- PM 같은 시스템 소유자는 `OWNER`로 단순 처리할 수 있다.

비용:

- 초기 seed permission matrix가 필요하다.
- UI에서 role/permission 관리 화면이 필요하다.
- 권한 캐시와 서버 검사 helper를 구현해야 한다.

## 대안

### enum role만 사용

단순하지만 요구사항을 곧바로 막습니다. 외주 개발자와 정규 개발자를 분리하려면 enum이 계속 늘어나고, 메뉴 내부 액션 권한도 표현하기 어렵습니다.

### 완전한 ABAC policy engine

강력하지만 초기 구현 비용이 큽니다. 현재 규모에서는 과합니다.

### RBAC + 사용자 속성

현재 선택안입니다. 단순한 RBAC를 기본으로 두고, employmentType/jobFunction과 JSON conditions를 필요한 곳에만 사용합니다.

## 갱신

### 2026-06-24 — MANAGER systemRole 폐지

`systemRole`의 MANAGER는 구현상 권한 엔진(`kernel/access`)에서 MEMBER와 동일하게 취급되어(coarse 게이트·권한 부여 어디에도 연결되지 않음) 실질 역할이 없었다. 위임 관리는 ADMIN systemRole + `admin` AccessRole 조합으로 충분히 표현된다. 따라서 MANAGER **신규 부여를 비활성화**한다:

- 사용자 편집 드롭다운(`SYSTEM_ROLE_OPTIONS`)에서 제외
- 입력 검증(`validations`의 zod `systemRole`)에서 제외 → API 부여 거부
- federation `ops-manager` 그룹 발급 중단

DB `kernel.SystemRole` enum 값과 TS `SystemRole` 타입은 **보존**한다 — enum 값 제거는 Postgres에서 비가역 타입 재생성 마이그레이션이라 비용 대비 실익이 적고, 기존 MANAGER 데이터 표시를 위해 `SYSTEM_ROLE_LABEL`도 유지한다. 운영 등급은 **OWNER/ADMIN/MEMBER 3단계**로 운영한다.

**기존 MANAGER 편집 보존**: 사용자 편집(PATCH)은 변경되지 않은 `systemRole`을 전송에서 생략한다 — 폐지된 MANAGER 사용자도 이름·팀·속성을 정상 편집할 수 있다(신규 부여만 드롭다운·zod로 차단).

**배포 게이트(전환기 호환)**: `ops-manager` 발급 중단은 외부 federation 출력(`/api/auth/verify`의 `X-Auth-Groups`)에 영향을 줄 수 있다. 배포 전 ① 잔존 MANAGER 사용자 0명(`SELECT count(*) FROM kernel."User" WHERE "systemRole"='MANAGER'`) ② 외부 소비자가 `ops-manager` 그룹에 미의존을 확인한다.

