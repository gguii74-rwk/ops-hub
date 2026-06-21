# 구현 계획 — 사용자 관리 ①계정 수명주기 + 관리자 사용자 관리

> 작성일 2026-06-21 · 브랜치 `feat/user-management` · spec: `docs/specs/2026-06-21-user-management-account-admin-design.md`

## 개요

**Goal:** ops-hub에 회원가입(자가 신청·C안 set-password)·승인/거절·관리자 직접추가·사용자 목록/편집·역할/개인 override 부여·비밀번호 변경/재설정·세션 무효화·위임 admin anti-escalation을 추가한다.

**Architecture:** 기존 `Route Handler → Service → Repository → Prisma` 계층을 그대로 따라 `src/modules/admin/users/{services,repositories,validations}/`에 도메인을 신설한다. 권한은 기존 `src/kernel/access`(`computeDecision` Deny우선·fail-closed)를 재사용하고, 위임 anti-escalation(D12/D13)은 라우트 권한키 검사와 **별개로 서비스 계층 가드**로 강제한다. 메일은 기존 공통 `MailDelivery` 아웃박스 + leave drain 워커를 `leaveRequestId`-optional로 일반화해 공유한다.

**Tech Stack:** Next.js App Router(서버 컴포넌트 + Route Handler), Prisma(PostgreSQL, multiSchema `kernel`/`workflows`), NextAuth(JWT credentials), bcryptjs, zod, vitest.

---

## For agentic workers — execution contract (MUST)

> REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-21-user-management/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts

이 절은 2개 이상 task가 참조하는 계약이다. task 파일은 타입/시그니처를 재인라인하지 말고 "entrypoint §Shared Contracts"를 가리킨다.

### S1. 스키마 / 마이그레이션 (task-01)

`prisma/schema.prisma` (kernel 스키마):

```prisma
enum UserStatus {
  PENDING    // 신규 — 자가 신청 후 승인 대기
  INVITED
  ACTIVE
  DISABLED
  REJECTED   // 신규 — 거절(이력 보존, 자가 재신청 차단)
  @@schema("kernel")
}

model User {
  // 기존 필드 유지. 변경/추가만 표기:
  passwordHash         String?    // 변경: nullable (자가가입은 set-password 전까지 null)
  mustChangePassword   Boolean    @default(false)  // 신규
  passwordChangedAt    DateTime?                    // 신규 — 비번변경 세션무효화 기준(D15)
  sessionInvalidatedAt DateTime?                    // 신규 — 비활성화/재설정 세션무효화 기준(D14·상태전이)
  emailVerifiedAt      DateTime?                    // 신규 — 이메일 소유 검증(D16)
  emailVerifyTokenHash String?                      // 신규 — 검증 겸 set-password 토큰 해시(C안)
  emailVerifyExpiresAt DateTime?                     // 신규 — 토큰 만료
  // @@index([status]) 추가 (목록 필터·가용성 카운트용)
}

// D18 레이트리밋 — DB-backed durable, 다중 인스턴스 안전
model RateBucket {
  id              String   @id @default(cuid())
  scope           String   // "signup:ip" | "signup:email" | "resend:email"
  key             String   // IP 또는 email(소문자)
  windowStartedAt DateTime
  count           Int      @default(0)
  updatedAt       DateTime @updatedAt
  @@unique([scope, key])
  @@index([scope, windowStartedAt])
  @@schema("kernel")
}
```

마이그레이션: `prisma migrate dev` 이름 `user_management_account_admin`. **기존 `passwordHash` non-null → nullable 전환은 데이터 무손실**(기존 행 모두 값 보유).

### S2. 권한 카탈로그 / 시드 (task-01)

- `src/kernel/access/catalog.ts`: `RESOURCES`에 `admin.users` 존재 ✓, `ACTIONS`에 `view/create/update/approve` 존재 ✓ — **catalog 변경 없음**.
- `prisma/seed-permissions.ts` `EXTRA_PERMISSIONS`에 추가: `["admin.users","create"]`, `["admin.users","approve"]`, `["admin.audit","view"]`(누락 시). (`admin.users:view`는 `VIEW_RESOURCES`, `:update`는 기존.)
- `prisma/seed-roles.ts` `ROLE_ALLOW`에 신설:
  ```ts
  admin: [
    "admin.users:view", "admin.users:create", "admin.users:update", "admin.users:approve",
    "admin.settings:configure", "admin.audit:view",
  ],
  ```
- `ACCESS_ROLE_KEYS`(catalog.ts)에 `"admin"` 추가. **시드 역할은 `seed.ts`에서 `ACCESS_ROLE_KEYS.map`으로 파생**되므로(배열 리터럴 아님), 역할 추가는 ① `ACCESS_ROLE_KEYS`에 `"admin"` + ② `seed.ts`의 `ROLE_NAMES`에 `admin: "사용자 관리자"`만 추가하면 된다(`isSystem:true`는 upsert create에 일괄 적용). 별도 역할 배열 리터럴 작성 금지.
- 시드 패턴(기존): Permission `upsert(resource_action)`, AccessRole `upsert(key)`, RolePermission `deleteMany(roleId)` 후 `createMany(skipDuplicates)`, `effect:"ALLOW"`, `scope:"all"`. `ROLE_ALLOW.pm = ["*"]`(전체) 유지.

### S3. 특권 식별 상수 (task-02가 정의, 여러 task 참조)

`src/modules/admin/users/policy.ts`:

```ts
// 위임 admin이 부여/회수할 수 없는 특권 역할 키(OWNER-only)
export const PRIVILEGED_ROLE_KEYS = ["pm", "admin"] as const;
// 특권 systemRole (OWNER-only 부여)
export const PRIVILEGED_SYSTEM_ROLES = ["OWNER", "ADMIN"] as const;
// 위임 admin이 타인에게 DENY override를 걸 수 없는 critical 리소스 prefix
export const CRITICAL_RESOURCE_PREFIXES = ["admin."] as const;
// "가용 user-management 관리자"로 인정하는 권한 키 (최소 1명 보존)
export const USER_MGMT_PERMISSION = "admin.users:update";
export const AUDIT_PERMISSION = "admin.audit:view";
// 역할이 보유한 RolePermission에 "*"/admin.* 가 있으면 특권 역할로 간주
export function isPrivilegedRoleKey(key: string): boolean;
```

### S4. 도메인 에러 (task-02가 정의, 여러 task 참조)

`src/modules/admin/users/errors.ts`:

```ts
export class UserConflictError extends Error {}      // 409 (status-CAS 충돌, 중복 이메일)
export class UserValidationError extends Error {}    // 400 (도메인 검증)
export class EscalationError extends Error {}        // 403 (D12/D13 anti-escalation 위반)
export class MinAvailabilityError extends Error {}   // 409 (D13ⓔ 최소 가용성 위반)
export class RateLimitError extends Error {}         // 429 (D18)
export class TokenError extends Error {}             // 400 (만료/위조 토큰)
```

라우트 매핑(`src/app/api/admin/users/_shared.ts`, signup 계열은 `src/app/api/auth/_shared.ts`):
`ForbiddenError`/`EscalationError`→403, `UserConflictError`/`MinAvailabilityError`→409, `UserValidationError`/`TokenError`→400, `RateLimitError`→429.

### S5. 가드 컨텍스트·시그니처 (task-02; task-03/04/05 호출)

```ts
// 행위자 컨텍스트 — 라우트에서 세션 + getPermissionSummary로 구성
export interface ActorContext {
  userId: string;
  isOwner: boolean;            // systemRole === "OWNER"
  permissionKeys: Set<string>; // getPermissionSummary().keys
}

// D12/D13 가드 (src/modules/admin/users/services/guards.ts) — 위반 시 EscalationError throw
export function assertNotSelfMutation(actor: ActorContext, targetUserId: string): void;            // D13ⓐ
export function assertCanAssignRoles(actor: ActorContext, roleKeys: string[]): void;               // D13ⓑ
export function assertCanSetSystemRole(actor: ActorContext, newRole: string | null): void;         // D12
export function assertOverrideWithinActorGrant(actor: ActorContext, key: string, effect: "ALLOW"|"DENY"): void; // D13ⓒⓓ

// D13ⓔ 최소 가용성 — advisory lock으로 직렬화 + 커밋 전 재검사
// availability-affecting mutation(role제거·override·disable·reset-password·systemRole강등)은 반드시 이 래퍼 안에서.
export async function withAvailabilityLock<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T>;
// 트랜잭션 내 커밋 전 호출. 가용 관리자/감사조회자 < 1 이면 MinAvailabilityError throw.
export async function assertMinAvailability(tx: PrismaTx): Promise<void>;
// 가용 카운트 (assertMinAvailability가 사용; computeDecision 재사용해 권한 보유 판정). guards.ts 소속.
export async function countAvailableByPermission(tx: PrismaTx, permissionKey: string): Promise<number>;
```

availability-affecting repository 함수(`setStatusTx`/`resetPasswordTx`/`setRoles`/`createOverride`/`updateUserTx`의 systemRole 강등)는 **내부에서 `withAvailabilityLock`로 감싸고 커밋 전 `assertMinAvailability(tx)`를 호출**한다(그래서 repository task-03이 guards task-02를 import → deps 02).

"가용(available)" 정의: `status === "ACTIVE" && mustChangePassword === false` 이고 해당 권한(USER_MGMT_PERMISSION / AUDIT_PERMISSION)을 `computeDecision`상 보유. advisory lock 키 = 고정 상수 `pg_advisory_xact_lock(4815162342)`(전역 직렬화).

### S6. Repository 시그니처 (task-03; task-04/05/07 호출)

`src/modules/admin/users/repositories/index.ts` — 모든 status/role/override/status-CAS는 leave `approveTx` 패턴(`findUnique`→`updateMany({where:{id,status,updatedAt}})`→`count===0`→`UserConflictError`).

```ts
export interface UserListFilter { status?: UserStatus; employmentType?: string; jobFunction?: string; q?: string; page: number; pageSize: number; }
export async function listUsers(f: UserListFilter): Promise<{ rows: UserRow[]; total: number; pendingCount: number }>;
export async function getUserDetail(id: string): Promise<UserDetail | null>;

// 자가가입(C안): 비번 없이 PENDING. 만료된 미검증 PENDING 교체 허용.
export async function createPendingSignup(args: { email: string; name: string; employmentType: string; jobFunction: string; department: string | null; tokenHash: string; tokenExpiresAt: Date; }): Promise<{ id: string }>;
// set-password 토큰 소비: passwordHash + emailVerifiedAt 기록, 토큰 소거. (PENDING 유지)
export async function setPasswordViaToken(tokenHash: string, passwordHash: string, now: Date): Promise<{ id: string } | null>;
export async function refreshVerifyToken(email: string, tokenHash: string, tokenExpiresAt: Date): Promise<{ id: string } | null>;

// 관리자 직접추가: 임시비번 → ACTIVE + mustChangePassword, emailVerifiedAt=now, 역할 부여.
export async function createActiveUserByAdminTx(args: { email: string; name: string; passwordHash: string; employmentType: string; jobFunction: string; department: string | null; systemRole: string; roleKeys: string[]; actorId: string; }): Promise<{ id: string }>;

// 승인/거절: status-CAS + 역할확정 + 감사 + 메일 enqueue(트랜잭션 내).
export async function approveTx(id: string, actorId: string, decision: { employmentType: string; jobFunction: string; systemRole: string; roleKeys: string[] }, mail: UserMailJob, expectedUpdatedAt: Date): Promise<void>;
export async function rejectTx(id: string, actorId: string, reason: string, mail: UserMailJob, expectedUpdatedAt: Date): Promise<void>;

export async function updateUserTx(id: string, patch: { name?: string; department?: string | null; employmentType?: string; jobFunction?: string; systemRole?: string }, actorId: string, expectedUpdatedAt: Date): Promise<void>;
export async function setRoles(id: string, roleKeys: string[], actorId: string): Promise<void>; // createMany skipDuplicates + deleteMany(차집합)
export async function createOverride(id: string, o: OverrideInput, actorId: string): Promise<{ id: string }>;
export async function deleteOverride(id: string, overrideId: string, actorId: string): Promise<void>;

// 세션 무효화 동반(D14·상태전이): sessionInvalidatedAt = now
export async function setStatusTx(id: string, status: "ACTIVE" | "DISABLED", actorId: string, now: Date): Promise<void>;
export async function reactivateRejectedTx(id: string, actorId: string, now: Date): Promise<void>; // REJECTED→ACTIVE
// reset-password(D14): 임시비번 → mustChangePassword=true + sessionInvalidatedAt=now
export async function resetPasswordTx(id: string, passwordHash: string, actorId: string, now: Date): Promise<void>;
// 강제변경/자가변경(D15): passwordHash + passwordChangedAt=now, mustChangePassword=false
export async function changePasswordTx(id: string, passwordHash: string, now: Date): Promise<void>;
// (가용성 카운트 함수는 S5 guards 소속 — 여기서 정의하지 않음)
```

### S7. Service / Validation 시그니처 (task-04; 라우트가 호출)

`src/modules/admin/users/services/index.ts` — 가드(S5) + repository(S6) + 메일(S8) + 감사 조합. 라우트는 이 계층만 호출.
주요: `approveUser(actor, id, input)`, `rejectUser(actor, id, reason)`, `createUserByAdmin(actor, input)`, `updateUser(actor, id, patch)`, `assignRoles(actor, id, roleKeys)`, `upsertOverride(actor, id, input)`, `removeOverride(actor, id, overrideId)`, `setUserStatus(actor, id, status)`, `resetPassword(actor, id)`, `listUsersForView(actor, filter)`, `getUserForEdit(actor, id)`.

zod 스키마(leave validations 패턴, 비번 정책 `z.string().min(12)`)는 **deps 분리상 파일을 나눈다**(task-06·07은 task-04에 의존하지 않으므로 공개/비번 스키마를 각자 소유):
- **task-04** `validations/index.ts` (admin 전용): `adminCreateSchema`, `approveSchema`(employmentType/jobFunction/systemRole/roleKeys[]), `rejectSchema`(reason), `updateUserSchema`, `rolesSchema`(roleKeys[]), `overrideSchema`(resource:action 키·effect·scope·reason·startsAt/endsAt).
- **task-06** `validations/signup.ts` (공개): `signupSchema`(email/name/employmentType/jobFunction/department — **비번 없음**), `setPasswordSchema`(token·password 12+), `resendSchema`(email).
- **task-07** `validations/change-password.ts`: `changePasswordSchema`(currentPassword?·newPassword 12+).

### S8. 메일 (task-03; task-04 사용) — 공통 MailDelivery 일반화

```ts
export interface UserMailJob { recipients: string[]; subject: string; bodyHtml: string }
export type UserMailEvent = "APPROVED" | "REJECTED" | "VERIFY_EMAIL";
```

- 사용자 메일은 `MailDelivery`에 `leaveRequestId=null`로 enqueue(Postgres unique는 NULL 복수 허용 → 충돌 없음). `eventType`에 `UserMailEvent` 사용, `recipients=[email]`.
- **leave drain 워커 일반화**(surgical, task-03 확정): `dueWhere`(listDueDeliveryIds+claimDelivery 공유)의 `leaveRequestId:{not:null}` 조건을 `eventType:{not:null}`로 변경(eventType null인 workflow 행은 계속 제외), `claimDelivery`의 `leaveRequestId` null 거부 가드 제거, `ClaimedDelivery.eventType`을 `string`으로 확장, `deadLetterStaleSending`도 동형 일반화. 발송 전 LeaveRequest 재확인·status 일치는 **`leaveRequestId`가 있을 때만**. leave의 4-event 동작 완전 보존.
- `setPasswordViaToken`/`refreshVerifyToken`은 `updateMany`(원자적 토큰+만료 매칭) 후 `findFirst`로 id 회수(task-03 구현). task-06은 반환 `{id}|null` 계약만 의존.
- 승인/거절 메일은 `approveTx`/`rejectTx` 트랜잭션 내 1회 `mailDelivery.create`(CAS가 중복 승인 차단 → 멱등키 불필요). 검증메일은 signup/resend 시 create(매번 새 토큰).
- 발송 후 `triggerLeaveMailDrain()` 재사용(fire-and-forget) 또는 동명의 공통 트리거.

### S9. 세션 무효화 + mustChangePassword 중앙 게이트 (task-07)

- **auth 콜백**(`src/lib/auth/config.ts`): `jwt` 콜백이 로그인 시 토큰에 `mustChange`·`status`·발급기준시각 저장. `session` 콜백이 **DB의 현재 `status`/`passwordChangedAt`/`sessionInvalidatedAt`/`mustChangePassword`를 조회**해, ① `status !== "ACTIVE"` 이거나 ② `passwordChangedAt`/`sessionInvalidatedAt`가 토큰 발급(`token.iat`) 이후면 → 세션 무효(`session.user`를 비우거나 무효 신호). `SessionUser`에 `mustChangePassword: boolean` 추가(types.ts). 세션 무효 판정은 **순수 헬퍼 `isSessionValid(tokenIat: number, snap: {status, passwordChangedAt, sessionInvalidatedAt}): boolean`**(`src/lib/auth/session-validity.ts`, task-07이 export)로 분리해 session 콜백이 호출하고 task-09가 단위테스트한다.
- **중앙 게이트**(`src/kernel/access` 또는 `src/lib/auth`에 공유 헬퍼): `getPermissionSummary(userId)`가 `mustChangePassword === true`면 **빈 `{keys:[]}` 반환**(fail-closed). `requirePermission`도 must-change면 거부. allowlist = `change-password`·`logout` 경로만 예외. UI 미들웨어 리다이렉트는 UX일 뿐.
- **라우트 열거 테스트**(task-09): must-change 세션으로 allowlist 외 모든 기존 API가 403/빈 summary임을 증명.

### S10. 공유 상수 (task-06 D18, task-01/06 토큰)

`src/modules/admin/users/rate-limit.ts` (task-06 신규 — D18 상수·강제 유틸을 함께 둔다; task-09 테스트도 여기서 import):

```ts
export const VERIFY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일 (D16 만료)
export const SIGNUP_IP_LIMIT = 10;          // per-IP 윈도우당 가입 시도
export const SIGNUP_EMAIL_LIMIT = 3;        // per-email 윈도우당 가입 시도
export const RESEND_COOLDOWN_MS = 60 * 1000;// 재발송 쿨다운
export const RATE_WINDOW_MS = 60 * 60 * 1000;// 레이트 윈도우 1시간
export const PENDING_UNVERIFIED_CAP = 200;  // 미처리 미검증 PENDING 전역 상한(bounded creation)
```

D18 강제는 **원자적·사전(pre-write)**: `RateBucket` upsert+increment를 트랜잭션으로 수행하고 `count > limit`이면 **User/MailDelivery 행 생성 전에** `RateLimitError`. 윈도우 만료(`windowStartedAt + RATE_WINDOW_MS < now`) 시 `count=1`·`windowStartedAt=now`로 리셋.

---

## Task 테이블

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 스키마·마이그레이션·권한 카탈로그/시드 | [ ] | [task-01](2026-06-21-user-management/task-01-schema-foundation.md) | — | |
| 02 | anti-escalation 가드 + 최소가용성(D12/D13) | [ ] | [task-02](2026-06-21-user-management/task-02-escalation-guards.md) | 01 | |
| 03 | admin/users repository (CAS·CRUD·세션무효화·메일) | [ ] | [task-03](2026-06-21-user-management/task-03-users-repository.md) | 01,02 | |
| 04 | admin/users service + validations | [ ] | [task-04](2026-06-21-user-management/task-04-users-service.md) | 02,03 | |
| 05 | admin API 라우트 | [ ] | [task-05](2026-06-21-user-management/task-05-admin-api.md) | 04 | |
| 06 | 자가가입·verify/set-password·D18 레이트리밋 | [ ] | [task-06](2026-06-21-user-management/task-06-signup-verify.md) | 01,03 | |
| 07 | 비번변경·세션무효화·중앙게이트(D15/D17)·auth 콜백 | [ ] | [task-07](2026-06-21-user-management/task-07-password-session.md) | 01,03 | |
| 08 | UI (가입·강제변경·목록·승인모달·편집·override·nav) | [ ] | [task-08](2026-06-21-user-management/task-08-ui.md) | 05,06,07 | |
| 09 | 통합 게이트/열거(D17)·남용(D18)·anti-escalation(D13) 테스트 | [ ] | [task-09](2026-06-21-user-management/task-09-gate-tests.md) | 05,06,07 | |

실행은 `superpowers:subagent-driven-development`. dependency 순서로 진행하되 06·07은 03 이후 병렬 가능.
