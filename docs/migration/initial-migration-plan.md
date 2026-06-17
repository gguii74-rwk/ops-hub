# 초기 마이그레이션 계획

## 원칙

- 기존 `day-sync`와 `annual-leave` 운영 DB는 직접 수정하지 않는다.
- 새 PostgreSQL DB에 적재한 뒤 검증한다.
- 검증 전까지 기존 서비스는 계속 운영한다.
- 비밀번호는 가능하면 재설정하거나, 해시 알고리즘이 동일한 경우에만 이전한다.

## 출처

| 출처 | DB | 주요 데이터 |
| --- | --- | --- |
| day-sync | SQLite | User, TaskType, Task, BillingConfig, BillingRoundDate, Deliverable |
| annual-leave | SQLite | User, LeaveAllocation, LeaveAllocationHistory, LeaveRequest, SystemSettings |

## 단계

### 1. 스키마 확정

- `prisma/schema.prisma` 초안을 검토한다.
- PostgreSQL에서 `prisma migrate dev`로 초기 migration을 만든다.
- seed 데이터 기준을 정한다.

### 2. 공통 사용자 병합 규칙 확정

이메일을 사용자 병합 키로 사용합니다.

```text
same email -> same User
day-sync only -> User 생성
annual-leave only -> User 생성
both -> role은 더 높은 권한 우선
```

권한 우선순위:

```text
ADMIN > MANAGER > MEMBER
```

`annual-leave`의 `EMPLOYEE`는 `MEMBER`, `ADMIN`은 `ADMIN`으로 매핑합니다.

### 3. day-sync 데이터 이전

| 기존 | 신규 |
| --- | --- |
| TaskType | WorkflowType |
| Task | WorkflowTask |
| BillingConfig | BillingConfig |
| BillingRoundDate | BillingRoundDate |
| Deliverable | Deliverable |

`Task.recipients`와 `TaskType.defaultRecipients`는 기존 문자열 JSON을 PostgreSQL `Json`으로 변환합니다.

### 4. annual-leave 데이터 이전

| 기존 | 신규 |
| --- | --- |
| User | User |
| LeaveAllocation | LeaveAllocation |
| LeaveAllocationHistory | LeaveAllocationHistory |
| LeaveRequest | LeaveRequest |
| SystemSettings | SystemSetting |

상태값은 다음처럼 매핑합니다.

| 기존 | 신규 |
| --- | --- |
| PENDING | PENDING |
| APPROVED | APPROVED |
| REJECTED | REJECTED |
| CANCELLED | CANCELLED |

### 5. 파일과 템플릿

`day-sync`의 `Template`, `keys`, `output` 운영 구조를 계승합니다.

- 템플릿은 Git에 넣지 않는다.
- 생성 output은 릴리즈 디렉터리와 분리한다.
- DB에는 상대 경로만 저장한다.

### 6. 병행 검증

최소 검증 항목:

- 로그인 가능
- 기존 업무 task 목록 수 일치
- 기존 billing config 연도별 값 일치
- 기존 deliverable 연도별 값 일치
- 연차 사용자 수 일치
- 사용자별 연차 할당/사용/잔여 계산 일치
- 승인 대기 연차 목록 일치
- 월간 연차 캘린더 일치

### 7. 전환

1. 기존 서비스 읽기 전용 전환
2. 최종 delta migration 실행
3. ops-hub 검증
4. 내부 링크/프록시 전환
5. 기존 `day-sync`, `annual-leave` 종료 또는 보관

## 아직 결정할 것

- 기존 비밀번호 해시를 그대로 이전할지, 전체 재설정을 할지
- `MANAGER` 역할을 부서장 개념으로 바로 쓸지
- 연차 승인자를 명시 필드로 둘지, role 기반으로만 둘지
- PostgreSQL 운영 위치와 DB명/계정명

