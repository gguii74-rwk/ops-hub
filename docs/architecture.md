# ops-hub Architecture

## 목표 구조

`ops-hub`는 하나의 Next.js 앱 안에서 업무 도메인을 모듈로 분리하는 모듈형 모놀리스입니다.

```text
app/
  (auth)/
  dashboard/
  workflows/
  leave/
  admin/
  api/

modules/
  workflows/
  leave/
  calendar/
  admin/
  integrations/

lib/
  auth/
  prisma/
  api/
  validation/
```

초기에는 `day-sync`의 구조를 유지해도 됩니다.

```text
Route Handler -> Service -> Repository -> Prisma
```

## 모듈 경계

### admin

공통 사용자, 권한, 설정, 감사 로그를 담당합니다.

- User
- Role
- SystemSetting
- AuditLog

### workflows

`day-sync`에서 온 업무 자동화 모듈입니다.

- 주간보고
- 대금청구
- 알림톡 보고서/청구
- 생성 파일
- 메일 발송 이력

기존 `TaskType`과 `Task`는 `WorkflowType`과 `WorkflowTask`로 이름을 명확히 바꿉니다.

### leave

`annual-leave`에서 온 연차 관리 모듈입니다.

- 연차 신청
- 관리자 승인/반려
- 연도별 연차 할당
- 할당 변경 이력
- 연차 캘린더

연차 상태값은 업무 자동화 상태값과 섞지 않습니다.

### calendar

업무 일정, 연차/근태, Google Calendar, 공휴일을 권한에 맞게 합성하는 모듈입니다.

- 업무 캘린더
- 휴가/근태 캘린더
- 개인 캘린더
- 팀 캘린더
- 외부 캘린더 캐시와 중복 제거

휴가/근태의 기준 데이터는 `LeaveRequest`이며, Google Calendar의 휴가성 일정은 전환기 보조 데이터로 취급합니다.

### integrations

외부 시스템과 파일 생성 기능입니다.

- Google Sheets
- Google Calendar
- SMTP
- LibreOffice
- Anthropic API
- 템플릿/출력 파일

## 인증과 권한

NextAuth Credentials 기반으로 시작합니다. 기존 `annual-leave`의 JWT 인증은 포팅하지 않습니다.

권한은 단순 `ADMIN/MEMBER` enum이 아니라 사용자 속성 + 역할/권한 테이블로 관리합니다.

- 사용자 속성: `employmentType`(정규/외주), `jobFunction`(PM/개발/컨텐츠관리/민원응대)
- coarse role: `systemRole`(OWNER/ADMIN/MANAGER/MEMBER)
- 업무 권한: `AccessRole`, `Permission`, `RolePermission`
- 예외 권한: `UserPermissionOverride`
- 메뉴 표시: `NavigationItem.requiredPermission`

자세한 설계는 [Access Control Design](access-control.md)을 따릅니다.

## 데이터 저장

PostgreSQL을 단일 DB로 사용합니다.

- 금액은 `BigInt`
- 연차 일수는 `Decimal`
- 수신자, 설정, 감사 metadata는 PostgreSQL `Json`
- 생성 파일은 DB에 경로와 메타데이터만 저장하고 실제 파일은 shared storage에 둡니다.

## 배포 방향

초기 운영은 `day-sync`의 검증된 방식과 맞춥니다.

```text
/home/opshub/apps/ops-hub/
  current -> releases/<release-id>
  incoming/
  releases/
  shared/
    output/
    Template/
    keys/
```

DB는 PostgreSQL에 두고, `output`, `Template`, `keys`는 릴리즈와 분리합니다.

### Reverse proxy / 클라이언트 IP 계약 (필수)

공개 라우트(`/api/auth/signup`·`/api/auth/verify-email`·`/api/auth/resend-verification`)의 per-IP 레이트리밋은 `X-Forwarded-For`의 **첫 값**을 클라이언트 IP로 사용한다(`src/modules/admin/users/rate-limit.ts` `extractClientIp`, D1·D18). 이 값을 신뢰하려면 **신뢰 가능한 ingress(reverse proxy)가 클라이언트가 보낸 `X-Forwarded-For`를 제거하고 실제 클라이언트 IP로 덮어써야 한다** — 그렇지 않으면(append/passthrough) 공격자가 첫 값을 위조해 임의 per-IP 버킷을 골라 per-IP 통제를 우회할 수 있다(token-probing·RateBucket 증폭·cap 압박 재개방). 배포 시 프록시 설정에서 이 계약을 강제할 것(예: nginx `proxy_set_header X-Forwarded-For $remote_addr;` — append `$proxy_add_x_forwarded_for`가 아니라 덮어쓰기). 단 per-IP는 defense-in-depth 계층일 뿐 — hard 경계(`PENDING_UNVERIFIED_CAP` 트랜잭션 내 강제·per-email 한도·재발송 쿨다운·검증 토큰 256bit 엔트로피·`emailVerifyTokenHash` 인덱스)는 IP에 의존하지 않아 XFF가 위조돼도 유지된다.
