# task-02 — anti-escalation 가드 + 최소 가용성 (D12/D13)

> 위임 `admin`(비-OWNER)이 권한을 자기에게 끌어올리거나 동료 관리자를 lockout 하거나 마지막 가용 관리자/감사조회자를 없애지 못하게, **라우트 권한키 검사와 별개로 서비스 계층에서 강제**하는 가드·최소가용성 불변식을 구현한다.

## Files

**Create**
- `src/modules/admin/users/policy.ts` — 특권 식별 상수(S3) + `isPrivilegedRoleKey`
- `src/modules/admin/users/errors.ts` — 도메인 에러 클래스(S4)
- `src/modules/admin/users/services/guards.ts` — `ActorContext` + 가드 시그니처(S5) 구현

**Test**
- `tests/modules/admin/users/policy.test.ts`
- `tests/modules/admin/users/guards.test.ts`

> Modify: 없음. 본 task는 신규 모듈만 추가한다(기존 코드 surgical 미변경).

## Prep

읽기(맥락 확인용, 재인라인 금지 — entrypoint §Shared Contracts가 단일 진실원):

- entrypoint `docs/plans/2026-06-21-user-management.md` §S3·S4·S5 (이 task가 정의하는 계약)
- `src/kernel/access/decision.ts` — `computeDecision`/`PermissionRule`/`Scope`/`permissionKey` 재사용
- `src/kernel/access/index.ts` — `ForbiddenError` 패턴, `withinValidity` 유효기간 로직(가드에서 동형 재현)
- `src/lib/prisma/index.ts` — `PrismaTx = Prisma.TransactionClient`, prisma 싱글톤
- `src/modules/leave/errors.ts` — 도메인 에러 클래스 패턴(`super(message); this.name = ...`)
- `src/modules/leave/repositories/index.ts` L51-62 — advisory xact lock 사용 예(`tx.$queryRaw\`SELECT pg_advisory_xact_lock(...)\``)
- `tests/modules/leave/repositories.test.ts` L1-43 — `vi.hoisted` prisma 모킹 패턴(`$transaction`이 cb에 fake db 주입)

## Deps

- **01** (스키마·마이그레이션): `User.mustChangePassword`/`status` 컬럼과 `UserStatus`(ACTIVE 등), `admin` AccessRole·`admin.users:update`/`admin.audit:view` Permission 시드가 존재해야 `countAvailableByPermission`이 의미를 가진다. 단 본 task의 단위테스트는 prisma를 모킹하므로 DB 없이 통과한다.

## TDD steps

> 규칙: 매 스텝 — 실패 테스트 작성 → 실행(expect FAIL) → 최소 구현 → 실행(expect PASS) → commit. 모든 코드 스텝은 전체 코드 인라인.

### Step 1 — policy 상수 + `isPrivilegedRoleKey` (실패 테스트)

`tests/modules/admin/users/policy.test.ts` 작성:

```ts
import { describe, expect, it } from "vitest";
import {
  NON_PRIVILEGED_ROLE_KEYS,
  PRIVILEGED_SYSTEM_ROLES,
  CRITICAL_RESOURCE_PREFIXES,
  USER_MGMT_PERMISSION,
  AUDIT_PERMISSION,
  isPrivilegedRoleKey,
} from "@/modules/admin/users/policy";

describe("policy 상수", () => {
  it("비특권 역할 키 allowlist는 개발/외주 4종 (D13ⓑ·finding I)", () => {
    expect([...NON_PRIVILEGED_ROLE_KEYS]).toEqual([
      "regular-developer", "contractor-developer", "contractor-content", "contractor-civil-response",
    ]);
  });
  it("특권 systemRole은 OWNER·ADMIN (D12)", () => {
    expect([...PRIVILEGED_SYSTEM_ROLES]).toEqual(["OWNER", "ADMIN"]);
  });
  it("critical prefix는 admin. (D13ⓓ)", () => {
    expect([...CRITICAL_RESOURCE_PREFIXES]).toEqual(["admin."]);
  });
  it("최소가용성 권한 키 (D13ⓔ)", () => {
    expect(USER_MGMT_PERMISSION).toBe("admin.users:update");
    expect(AUDIT_PERMISSION).toBe("admin.audit:view");
  });
});

describe("isPrivilegedRoleKey (sync, fail-closed — 비특권 allowlist 반전, finding I)", () => {
  it("개발/외주 4종만 비특권", () => {
    expect(isPrivilegedRoleKey("regular-developer")).toBe(false);
    expect(isPrivilegedRoleKey("contractor-developer")).toBe(false);
    expect(isPrivilegedRoleKey("contractor-content")).toBe(false);
    expect(isPrivilegedRoleKey("contractor-civil-response")).toBe(false);
  });
  it("pm·admin은 특권", () => {
    expect(isPrivilegedRoleKey("pm")).toBe(true);
    expect(isPrivilegedRoleKey("admin")).toBe(true);
  });
  it("미지의 키는 **특권**(fail-closed — finding I, 이전 fail-open 반전)", () => {
    expect(isPrivilegedRoleKey("unknown")).toBe(true);
  });
  it("다른 키로 admin 권한을 묶은 seeded/import/future 역할도 특권(비특권 allowlist에 없음)", () => {
    // 예: 카탈로그 외 키 'superadmin'·'auditor' 등 — admin.* 권한 보유 여부와 무관하게 allowlist에 없으면 특권으로 보호.
    expect(isPrivilegedRoleKey("superadmin")).toBe(true);
    expect(isPrivilegedRoleKey("auditor")).toBe(true);
  });
});
```

실행: `npm test -- tests/modules/admin/users/policy.test.ts` → **FAIL** (모듈 미존재).

### Step 2 — policy 구현 (PASS)

`src/modules/admin/users/policy.ts`:

```ts
// 위임 admin(비-OWNER)이 자유롭게 부여/회수할 수 있는 **비특권** 역할 키 allowlist(seed 고정 — 개발/외주 4종). spec D13ⓑ·finding I.
// 이 4종은 `prisma/seed-roles.ts`상 admin.*·"*" 권한이 전혀 없음이 보장된다(under-classify 위험 없음).
export const NON_PRIVILEGED_ROLE_KEYS = [
  "regular-developer", "contractor-developer", "contractor-content", "contractor-civil-response",
] as const;

// OWNER-only 로 부여 가능한 특권 systemRole. spec D12.
export const PRIVILEGED_SYSTEM_ROLES = ["OWNER", "ADMIN"] as const;

// 위임 admin이 타인에게 override(ALLOW·DENY 무관)를 걸 수 없는 critical 리소스 prefix(OWNER-only). spec D13ⓓ.
export const CRITICAL_RESOURCE_PREFIXES = ["admin."] as const;

// "가용 user-management 관리자"로 인정하는 권한 키 (최소 1명 보존). spec D13ⓔ.
export const USER_MGMT_PERMISSION = "admin.users:update";
// "가용 감사 조회자"로 인정하는 권한 키 (최소 1명 보존). spec D13ⓔ.
export const AUDIT_PERMISSION = "admin.audit:view";

// 역할 키가 특권인지 판정 — **fail-closed**(finding I). 비특권 allowlist에 없으면 특권으로 본다(DB 조회 없음·sync).
// pm·admin뿐 아니라 다른 키로 admin.* 권한을 묶은 seeded/import/future 역할, 미지의 키까지 모두 특권으로 보호한다.
// (이전 `PRIVILEGED_ROLE_KEYS=["pm","admin"]` 화이트리스트는 그 밖의 admin-bearing 역할을 비특권으로 흘리는 fail-open이었다.)
export function isPrivilegedRoleKey(key: string): boolean {
  return !(NON_PRIVILEGED_ROLE_KEYS as readonly string[]).includes(key);
}
```

실행: `npm test -- tests/modules/admin/users/policy.test.ts` → **PASS**.

commit: `feat(user-mgmt): task-02 특권 식별 상수·isPrivilegedRoleKey (S3)`

### Step 3 — 도메인 에러 클래스 (실패 테스트 + 구현 동시)

> 에러 클래스는 동작이 단순(`name` 설정·`instanceof`)하므로 1스텝으로 묶는다.

`tests/modules/admin/users/guards.test.ts` 상단(에러 부분만 우선)에 추가하는 대신, 에러는 guards 테스트에서 `instanceof`로 간접 검증한다. 별도 에러 전용 테스트는 만들지 않는다(과한 테스트 회피 — leave/errors.ts도 전용 테스트 없음).

`src/modules/admin/users/errors.ts`:

```ts
// admin/users 도메인 에러. 라우트 매핑(entrypoint §S4):
// ForbiddenError/EscalationError→403, UserConflictError/MinAvailabilityError→409,
// UserValidationError/TokenError→400, RateLimitError→429.

export class UserConflictError extends Error {
  constructor(message: string) { super(message); this.name = "UserConflictError"; }
}
export class UserValidationError extends Error {
  constructor(message: string) { super(message); this.name = "UserValidationError"; }
}
export class EscalationError extends Error {
  constructor(message: string) { super(message); this.name = "EscalationError"; }
}
export class MinAvailabilityError extends Error {
  constructor(message: string) { super(message); this.name = "MinAvailabilityError"; }
}
export class RateLimitError extends Error {
  constructor(message: string) { super(message); this.name = "RateLimitError"; }
}
export class TokenError extends Error {
  constructor(message: string) { super(message); this.name = "TokenError"; }
}
```

실행: `npm run typecheck` → **PASS**(타입만 확인; 동작은 Step 5에서 검증).

commit: `feat(user-mgmt): task-02 admin/users 도메인 에러 클래스 (S4)`

### Step 4 — sync 가드 4종 실패 테스트

`tests/modules/admin/users/guards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assertNotSelfMutation,
  assertCanAssignRoles,
  assertCanSetSystemRole,
  assertOverrideWithinActorGrant,
  type ActorContext,
} from "@/modules/admin/users/services/guards";
import { EscalationError } from "@/modules/admin/users/errors";

const owner = (id = "owner1"): ActorContext => ({ userId: id, isOwner: true, permissionKeys: new Set() });
const delegate = (keys: string[], id = "admin1"): ActorContext => ({
  userId: id, isOwner: false, permissionKeys: new Set(keys),
});

describe("assertNotSelfMutation (D13ⓐ)", () => {
  it("비-OWNER가 자기 자신 mutation → EscalationError", () => {
    expect(() => assertNotSelfMutation(delegate([], "u1"), "u1")).toThrow(EscalationError);
  });
  it("비-OWNER가 타인 mutation → 허용", () => {
    expect(() => assertNotSelfMutation(delegate([], "u1"), "u2")).not.toThrow();
  });
  it("OWNER는 자기 자신도 허용", () => {
    expect(() => assertNotSelfMutation(owner("u1"), "u1")).not.toThrow();
  });
});

describe("assertCanAssignRoles (D13ⓑ — 현재↔원하는 역할 집합 비교)", () => {
  it("비-OWNER가 특권 역할(pm) 추가 → EscalationError", () => {
    expect(() => assertCanAssignRoles(delegate([]), ["regular-developer"], ["regular-developer", "pm"])).toThrow(EscalationError);
  });
  it("비-OWNER가 특권 역할(admin) 추가 → EscalationError", () => {
    expect(() => assertCanAssignRoles(delegate([]), [], ["admin"])).toThrow(EscalationError);
  });
  it("비-OWNER가 기존 특권 역할(pm)을 목록에서 빼서 제거 → EscalationError(lockout 방지)", () => {
    // 현재 pm 보유 → next 목록에서 누락 = 제거. 추가가 아니어도 특권이 건드려지면 OWNER-only.
    expect(() => assertCanAssignRoles(delegate([]), ["regular-developer", "pm"], ["regular-developer"])).toThrow(EscalationError);
  });
  it("비-OWNER가 기존 특권 역할(admin)을 제거 → EscalationError", () => {
    expect(() => assertCanAssignRoles(delegate([]), ["admin"], [])).toThrow(EscalationError);
  });
  it("비-OWNER가 비특권 역할만 추가·제거 → 허용", () => {
    // 현재 [regular-developer] → next [contractor-content]: 추가·제거 모두 비특권.
    expect(() => assertCanAssignRoles(delegate([]), ["regular-developer"], ["contractor-content"])).not.toThrow();
  });
  it("비-OWNER가 특권 역할(pm)을 그대로 유지(추가·제거 없음) → 허용(차집합 비어 있음)", () => {
    // 현재·next 모두 pm 보유 → 특권 역할이 건드려지지 않았으므로 허용.
    expect(() => assertCanAssignRoles(delegate([]), ["pm", "regular-developer"], ["pm", "contractor-content"])).not.toThrow();
  });
  it("OWNER는 특권 역할 추가·제거 모두 허용", () => {
    expect(() => assertCanAssignRoles(owner(), [], ["pm", "admin"])).not.toThrow();
    expect(() => assertCanAssignRoles(owner(), ["pm", "admin"], [])).not.toThrow();
  });
});

describe("assertCanSetSystemRole (D12 — 현재·원하는 systemRole 모두 검사)", () => {
  it("비-OWNER가 OWNER 부여 → EscalationError", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "MEMBER", "OWNER")).toThrow(EscalationError);
  });
  it("비-OWNER가 ADMIN 부여 → EscalationError", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "MEMBER", "ADMIN")).toThrow(EscalationError);
  });
  it("비-OWNER가 기존 OWNER를 MEMBER로 강등 → EscalationError(현재가 특권이면 OWNER-only)", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "OWNER", "MEMBER")).toThrow(EscalationError);
  });
  it("비-OWNER가 기존 ADMIN을 MANAGER로 강등 → EscalationError", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "ADMIN", "MANAGER")).toThrow(EscalationError);
  });
  it("비-OWNER가 비특권↔비특권 변경(MEMBER→MANAGER) → 허용", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "MEMBER", "MANAGER")).not.toThrow();
    expect(() => assertCanSetSystemRole(delegate([]), "MANAGER", "MEMBER")).not.toThrow();
  });
  it("newRole null(변경 없음)이고 현재도 비특권 → 허용", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "MEMBER", null)).not.toThrow();
  });
  it("newRole null(변경 없음)이지만 현재가 특권(ADMIN)이면 → EscalationError(가용성 영향 mutation 차단)", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "ADMIN", null)).toThrow(EscalationError);
  });
  it("OWNER는 강등·승격 모두 허용", () => {
    expect(() => assertCanSetSystemRole(owner(), "MEMBER", "OWNER")).not.toThrow();
    expect(() => assertCanSetSystemRole(owner(), "OWNER", "MEMBER")).not.toThrow();
  });
});

describe("assertOverrideWithinActorGrant (D13ⓒⓓ — critical은 effect 무관 OWNER-only)", () => {
  it("ALLOW: 비-critical actor 보유 권한이면 허용", () => {
    expect(() =>
      assertOverrideWithinActorGrant(delegate(["leave.approval:approve"]), "leave.approval:approve", "ALLOW"),
    ).not.toThrow();
  });
  it("ALLOW: 비-critical actor 미보유 권한이면 EscalationError(가진 것 이상 못 줌)", () => {
    expect(() =>
      assertOverrideWithinActorGrant(delegate([]), "leave.approval:approve", "ALLOW"),
    ).toThrow(EscalationError);
  });
  it("DENY: 비-critical 권한은 위임 admin 허용", () => {
    expect(() =>
      assertOverrideWithinActorGrant(delegate([]), "leave.approval:approve", "DENY"),
    ).not.toThrow();
  });
  it("ALLOW: critical(admin.users:update)은 actor가 보유하고 있어도 비-OWNER 거부(finding D — 경계 우회 방지)", () => {
    expect(() =>
      assertOverrideWithinActorGrant(delegate(["admin.users:update"]), "admin.users:update", "ALLOW"),
    ).toThrow(EscalationError);
  });
  it("ALLOW: critical(admin.audit:view)은 actor가 보유하고 있어도 비-OWNER 거부(finding D)", () => {
    expect(() =>
      assertOverrideWithinActorGrant(delegate(["admin.audit:view"]), "admin.audit:view", "ALLOW"),
    ).toThrow(EscalationError);
  });
  it("DENY: critical(admin.*) 권한은 비-OWNER 거부(lockout 방지)", () => {
    expect(() =>
      assertOverrideWithinActorGrant(delegate(["admin.users:update"]), "admin.users:update", "DENY"),
    ).toThrow(EscalationError);
  });
  it("OWNER는 critical ALLOW·critical DENY·비-critical 미보유 ALLOW 모두 허용", () => {
    expect(() => assertOverrideWithinActorGrant(owner(), "admin.users:update", "ALLOW")).not.toThrow();
    expect(() => assertOverrideWithinActorGrant(owner(), "admin.users:update", "DENY")).not.toThrow();
    expect(() => assertOverrideWithinActorGrant(owner(), "admin.audit:view", "ALLOW")).not.toThrow();
    expect(() => assertOverrideWithinActorGrant(owner(), "leave.approval:approve", "ALLOW")).not.toThrow();
  });
});
```

실행: `npm test -- tests/modules/admin/users/guards.test.ts` → **FAIL** (모듈 미존재).

### Step 5 — sync 가드 + `ActorContext` 구현 (PASS)

> 이 스텝에서 `withAvailabilityLock`/`assertMinAvailability`/`countAvailableByPermission`도 함께 정의한다(같은 파일·async 부분은 Step 6에서 검증). sync 가드는 본 스텝 테스트로 즉시 검증된다.

`src/modules/admin/users/services/guards.ts`:

```ts
import "server-only";
import { prisma, type PrismaTx } from "@/lib/prisma";
import { computeDecision, permissionKey, type PermissionRule, type Scope } from "@/kernel/access/decision";
import { EscalationError, MinAvailabilityError } from "@/modules/admin/users/errors";
import {
  isPrivilegedRoleKey,
  PRIVILEGED_SYSTEM_ROLES,
  CRITICAL_RESOURCE_PREFIXES,
  USER_MGMT_PERMISSION,
  AUDIT_PERMISSION,
} from "@/modules/admin/users/policy";

// 행위자 컨텍스트 — 라우트에서 세션 + getPermissionSummary로 구성(entrypoint §S5).
export interface ActorContext {
  userId: string;
  isOwner: boolean;            // systemRole === "OWNER"
  permissionKeys: Set<string>; // getPermissionSummary().keys
}

// 전역 직렬화용 advisory lock 키(고정 상수). 모든 availability-affecting mutation을 한 줄로 세운다.
const AVAILABILITY_LOCK_KEY = 4815162342n;

// 권한 키가 critical(admin.*) prefix에 속하는지.
function isCriticalKey(key: string): boolean {
  return CRITICAL_RESOURCE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// D13ⓐ — 비-OWNER는 자기 자신을 대상으로 한 권한 mutation을 할 수 없다(자가 상승 차단).
export function assertNotSelfMutation(actor: ActorContext, targetUserId: string): void {
  if (actor.isOwner) return;
  if (actor.userId === targetUserId) {
    throw new EscalationError("자기 자신의 권한·상태는 변경할 수 없습니다.");
  }
}

// D13ⓑ — 특권 역할(pm·admin)의 **부여·회수 양쪽**이 OWNER-only. 현재(currentRoleKeys)와 원하는(nextRoleKeys)
// 집합의 **차집합**(추가된 것 ∪ 제거된 것) 중 특권 역할이 하나라도 있으면 비-OWNER는 거부한다.
// 추가 차단뿐 아니라 위임 admin이 목록에서 빼는 방식으로 기존 pm/admin을 떼어내 동료를 lockout하는 것도 막는다(finding C).
export function assertCanAssignRoles(
  actor: ActorContext, currentRoleKeys: string[], nextRoleKeys: string[],
): void {
  if (actor.isOwner) return;
  const current = new Set(currentRoleKeys);
  const next = new Set(nextRoleKeys);
  // 차집합: 추가(next에는 있고 current엔 없음) ∪ 제거(current엔 있고 next엔 없음).
  const added = nextRoleKeys.filter((k) => !current.has(k));
  const removed = currentRoleKeys.filter((k) => !next.has(k));
  const touchedPrivileged = [...added, ...removed].filter(isPrivilegedRoleKey);
  if (touchedPrivileged.length > 0) {
    throw new EscalationError(`특권 역할(${[...new Set(touchedPrivileged)].join(", ")}) 부여·회수는 OWNER만 가능합니다.`);
  }
}

// D12 — **현재 또는 원하는** systemRole이 OWNER/ADMIN을 건드리면 OWNER-only. 특권으로 승격하는 것뿐 아니라
// 기존 OWNER/ADMIN을 MEMBER/MANAGER로 강등하는 것도 비-OWNER는 거부한다(finding C — 강등으로 동료 특권 제거 방지).
// newRole이 null이면 systemRole 변경 의도 없음이지만, 현재가 특권이면(가용성 영향) 여전히 OWNER-only로 본다.
export function assertCanSetSystemRole(
  actor: ActorContext, currentRole: string, newRole: string | null,
): void {
  if (actor.isOwner) return;
  const privileged = PRIVILEGED_SYSTEM_ROLES as readonly string[];
  if (privileged.includes(currentRole)) {
    throw new EscalationError(`현재 ${currentRole} systemRole의 변경은 OWNER만 가능합니다.`);
  }
  if (newRole !== null && privileged.includes(newRole)) {
    throw new EscalationError(`${newRole} systemRole 부여는 OWNER만 가능합니다.`);
  }
}

// D13ⓒ — 비-critical ALLOW override는 actor가 실제 보유한 권한 한도 내에서만(가진 것 이상 못 줌).
// D13ⓓ — critical(admin.*) 권한 override는 effect 무관(ALLOW·DENY 모두) OWNER-only.
//   ALLOW: 위임 admin이 `admin.users:update` 등을 보유하더라도 ALLOW override로 타인에게 동등 admin 권한을
//          우회 부여하는 것 차단(보호된 역할/systemRole 부여 없이 OWNER-only 위임 경계 우회 방지 — finding D).
//   DENY:  동료 관리자를 critical 권한에서 lockout 하는 것 차단.
// 비-critical만 기존 로직(ALLOW=actor 보유 한도 내, DENY=허용).
export function assertOverrideWithinActorGrant(
  actor: ActorContext, key: string, effect: "ALLOW" | "DENY",
): void {
  if (actor.isOwner) return;
  // critical 권한은 effect와 무관하게 OWNER-only(actor가 보유하고 있어도 ALLOW 불가).
  if (isCriticalKey(key)) {
    throw new EscalationError(`critical 권한(${key})에 대한 override(${effect})는 OWNER만 가능합니다.`);
  }
  // 이하 비-critical 권한.
  if (effect === "ALLOW" && !actor.permissionKeys.has(key)) {
    throw new EscalationError(`보유하지 않은 권한(${key})은 ALLOW로 부여할 수 없습니다.`);
  }
  // 비-critical DENY는 허용.
}

// ── 최소 가용성(D13ⓔ) — advisory lock 직렬화 + 커밋 전 재검사 ──

// availability-affecting mutation을 감싸는 트랜잭션 래퍼. 시작에서 전역 advisory xact lock을 잡아
// 동시 mutation을 한 줄로 직렬화한다(트랜잭션 종료 시 자동 해제 — xact lock).
export async function withAvailabilityLock<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AVAILABILITY_LOCK_KEY})`;
    return fn(tx);
  });
}

// 커밋 전 호출. 가용 user-management 관리자 또는 audit 조회자가 1명 미만이면 거부.
export async function assertMinAvailability(tx: PrismaTx): Promise<void> {
  const userMgmt = await countAvailableByPermission(tx, USER_MGMT_PERMISSION);
  if (userMgmt < 1) {
    throw new MinAvailabilityError("최소 1명의 가용 사용자 관리자가 남아야 합니다.");
  }
  const audit = await countAvailableByPermission(tx, AUDIT_PERMISSION);
  if (audit < 1) {
    throw new MinAvailabilityError("최소 1명의 가용 감사 조회자가 남아야 합니다.");
  }
}

// 유효기간 내 규칙만 인정(access/index.ts withinValidity와 동형).
function withinValidity(startsAt: Date | null, endsAt: Date | null, now: Date): boolean {
  if (startsAt && startsAt > now) return false;
  if (endsAt && endsAt < now) return false;
  return true;
}

// permissionKey가 "resource:action"이라 마지막 ':'로 분리(resource에 '.'은 있으나 ':'은 없음).
function splitKey(key: string): { resource: string; action: string } {
  const i = key.lastIndexOf(":");
  return { resource: key.slice(0, i), action: key.slice(i + 1) };
}

// "가용(available)" = status==="ACTIVE" && mustChangePassword===false 인 사용자 중,
// computeDecision(override+role) 또는 OWNER로 permissionKey를 보유한 사람 수.
// computeDecision을 재사용해 Deny우선·fail-closed 규칙을 권한 엔진과 일치시킨다.
export async function countAvailableByPermission(tx: PrismaTx, permissionKeyStr: string): Promise<number> {
  const now = new Date();
  const { resource, action } = splitKey(permissionKeyStr);

  const permission = await tx.permission.findUnique({
    where: { resource_action: { resource, action } },
    select: { id: true },
  });
  // 권한 정의 자체가 없으면 OWNER만 보유로 친다(권한 엔진과 동일: 비-OWNER는 미정의 권한 미보유).
  const permissionId = permission?.id ?? null;

  const candidates = await tx.user.findMany({
    where: { status: "ACTIVE", mustChangePassword: false },
    select: {
      systemRole: true,
      roleAssignments: { select: { roleId: true, startsAt: true, endsAt: true } },
      permissionOverrides: permissionId
        ? {
            where: { permissionId },
            select: { effect: true, scope: true, startsAt: true, endsAt: true },
          }
        : false,
    },
  });

  // 비-OWNER 후보가 보유한 역할 → 해당 permission의 RolePermission 규칙을 한 번에 로드.
  const roleIds = Array.from(
    new Set(
      candidates
        .filter((u) => u.systemRole !== "OWNER")
        .flatMap((u) => u.roleAssignments.filter((a) => withinValidity(a.startsAt, a.endsAt, now)).map((a) => a.roleId)),
    ),
  );
  const rolePerms =
    permissionId && roleIds.length
      ? await tx.rolePermission.findMany({
          where: { permissionId, roleId: { in: roleIds } },
          select: { roleId: true, effect: true, scope: true },
        })
      : [];
  const ruleByRole = new Map<string, PermissionRule[]>();
  for (const rp of rolePerms) {
    const list = ruleByRole.get(rp.roleId) ?? [];
    list.push({ effect: rp.effect, scope: rp.scope as Scope });
    ruleByRole.set(rp.roleId, list);
  }

  let count = 0;
  for (const u of candidates) {
    if (u.systemRole === "OWNER") {
      count += 1;
      continue;
    }
    const overrides: PermissionRule[] = (u.permissionOverrides ?? [])
      .filter((o) => withinValidity(o.startsAt, o.endsAt, now))
      .map((o) => ({ effect: o.effect, scope: o.scope as Scope }));
    const roleRules: PermissionRule[] = u.roleAssignments
      .filter((a) => withinValidity(a.startsAt, a.endsAt, now))
      .flatMap((a) => ruleByRole.get(a.roleId) ?? []);
    if (computeDecision({ isOwner: false, overrides, roleRules })) count += 1;
  }
  return count;
}

// permissionKey re-export (라우트/서비스가 키 조립 시 동일 헬퍼 사용 — 일관성).
export { permissionKey };
```

실행: `npm test -- tests/modules/admin/users/guards.test.ts` → **PASS** (sync 가드 검증).

commit: `feat(user-mgmt): task-02 anti-escalation sync 가드 + ActorContext (S5 D12/D13ⓐ-ⓓ)`

### Step 6 — `countAvailableByPermission` / `assertMinAvailability` async 테스트 (실패 → 이미 구현됨 → PASS)

> async 부분은 Step 5에서 함께 구현했다. 이 스텝은 **테스트를 추가**해 행동을 고정한다(prisma 모킹). 테스트 없이 구현만 있으면 회귀를 못 잡으므로 별도 스텝으로 둔다.

`tests/modules/admin/users/guards.test.ts`에 이어 추가:

```ts
import { vi } from "vitest";
import { countAvailableByPermission, assertMinAvailability } from "@/modules/admin/users/services/guards";
import { MinAvailabilityError } from "@/modules/admin/users/errors";
import type { PrismaTx } from "@/lib/prisma";

// permissionId 조회 → user.findMany → rolePermission.findMany 를 모킹한 fake tx.
function fakeTx(opts: {
  permissionId: string | null;
  users: Array<{
    systemRole: string;
    roleAssignments?: Array<{ roleId: string; startsAt: Date | null; endsAt: Date | null }>;
    permissionOverrides?: Array<{ effect: "ALLOW" | "DENY"; scope: string; startsAt: Date | null; endsAt: Date | null }>;
  }>;
  rolePerms?: Array<{ roleId: string; effect: "ALLOW" | "DENY"; scope: string }>;
}): PrismaTx {
  const tx = {
    permission: {
      findUnique: vi.fn(async () => (opts.permissionId ? { id: opts.permissionId } : null)),
    },
    user: {
      findMany: vi.fn(async () =>
        opts.users.map((u) => ({
          systemRole: u.systemRole,
          roleAssignments: u.roleAssignments ?? [],
          permissionOverrides: u.permissionOverrides ?? [],
        })),
      ),
    },
    rolePermission: { findMany: vi.fn(async () => opts.rolePerms ?? []) },
  };
  return tx as unknown as PrismaTx;
}

describe("countAvailableByPermission (computeDecision 재사용)", () => {
  it("OWNER는 권한 미정의여도 보유로 카운트", async () => {
    const tx = fakeTx({ permissionId: null, users: [{ systemRole: "OWNER" }, { systemRole: "MEMBER" }] });
    expect(await countAvailableByPermission(tx, "admin.users:update")).toBe(1);
  });
  it("역할 ALLOW(all) 보유자 카운트, override DENY는 제외(Deny우선)", async () => {
    const tx = fakeTx({
      permissionId: "p1",
      users: [
        { systemRole: "MEMBER", roleAssignments: [{ roleId: "r1", startsAt: null, endsAt: null }] },
        {
          systemRole: "MEMBER",
          roleAssignments: [{ roleId: "r1", startsAt: null, endsAt: null }],
          permissionOverrides: [{ effect: "DENY", scope: "all", startsAt: null, endsAt: null }],
        },
      ],
      rolePerms: [{ roleId: "r1", effect: "ALLOW", scope: "all" }],
    });
    expect(await countAvailableByPermission(tx, "admin.users:update")).toBe(1);
  });
  it("만료된 역할 부여는 미보유(유효기간 밖)", async () => {
    const past = new Date("2000-01-01T00:00:00Z");
    const tx = fakeTx({
      permissionId: "p1",
      users: [{ systemRole: "MEMBER", roleAssignments: [{ roleId: "r1", startsAt: null, endsAt: past }] }],
      rolePerms: [{ roleId: "r1", effect: "ALLOW", scope: "all" }],
    });
    expect(await countAvailableByPermission(tx, "admin.users:update")).toBe(0);
  });
});

describe("assertMinAvailability (D13ⓔ)", () => {
  it("user-management 가용 0 → MinAvailabilityError", async () => {
    const tx = fakeTx({ permissionId: "p1", users: [] }); // 아무도 권한 없음
    await expect(assertMinAvailability(tx)).rejects.toThrow(MinAvailabilityError);
  });
  it("user-management·audit 모두 ≥1 → 통과(OWNER 한 명이 둘 다 충족)", async () => {
    const tx = fakeTx({ permissionId: null, users: [{ systemRole: "OWNER" }] });
    await expect(assertMinAvailability(tx)).resolves.toBeUndefined();
  });
});
```

실행: `npm test -- tests/modules/admin/users/guards.test.ts` → **PASS**.

> 주의: `assertMinAvailability`는 내부에서 `countAvailableByPermission`을 **두 번**(USER_MGMT_PERMISSION, AUDIT_PERMISSION) 호출하므로, fake tx의 `permission.findUnique`/`user.findMany`/`rolePermission.findMany`는 호출마다 동일 응답을 반환하면 된다(위 `fakeTx`가 그렇게 동작 — 매 호출 새 결과 생성). 두 권한을 다르게 흉내내려면 mock에 호출 카운터를 둔다(현 테스트는 동일 응답으로 충분).

commit: `test(user-mgmt): task-02 가용성 카운트·최소가용성 단위테스트 (D13ⓔ)`

## Acceptance Criteria

1. **typecheck**
   ```bash
   npm run typecheck
   ```
   기대: 에러 0건(종료코드 0). `tsc --noEmit` 출력에 `src/modules/admin/users/*` 관련 에러 없음.

2. **단위테스트**
   ```bash
   npm test -- tests/modules/admin/users
   ```
   기대: `policy.test.ts` + `guards.test.ts`의 모든 케이스 PASS, 실패 0.
   출력 예: `Test Files  2 passed (2)` / `Tests  NN passed (NN)`.

3. **lint**
   ```bash
   npm run lint
   ```
   기대: 신규 파일에 eslint(boundaries 포함) 위반 없음. `services/guards.ts`는 `@/kernel/access`·`@/lib/prisma`·동일 모듈만 import → 경계 위반 없음.

## Cautions

- **advisory lock 키는 고정 상수**(`4815162342n`, bigint). leave 도메인의 advisory lock(`LEAVE_OVERLAP_LOCK_NS=0x6c76`, 2-인자 `int4` 형태)과 **다른 시그니처**(1-인자 `bigint`)라 키스페이스가 겹치지 않는다. 전역 직렬화가 목적이므로 사용자/리소스별로 쪼개지 말 것.
- **`withAvailabilityLock`/`assertMinAvailability`는 본 task에서 정의만** 한다. 실제 호출(repository의 `setStatusTx`/`resetPasswordTx`/`setRoles`/`createOverride`/`updateUserTx` systemRole 강등이 이 래퍼 안에서 커밋 전 `assertMinAvailability(tx)` 호출)은 **task-03**이다 — 여기서 호출처를 만들지 말 것(범위 밖, 미사용 코드 금지 원칙에 걸리지 않게 export만 노출).
- **`isPrivilegedRoleKey`는 sync·fail-closed 판정**(DB 조회 없음, D13ⓑ·finding I). 비특권 allowlist(`NON_PRIVILEGED_ROLE_KEYS` = 개발/외주 4종)에 **없으면 특권**이다 — pm·admin은 물론 다른 키로 admin.* 권한을 묶은 seeded/import/future 역할, 미지/커스텀 키까지 모두 특권으로 보호한다(이전 `["pm","admin"]` 화이트리스트의 fail-open을 반전). 비특권 4종은 `prisma/seed-roles.ts`상 admin.*·"*" 권한이 전혀 없으므로 under-classify 위험이 없다 — 데이터 기반 런타임 RolePermission 조회 없이도 정확하고 보수적이다(hot 가드 경로를 sync로 단순 유지).
- **`assertCanAssignRoles`·`assertCanSetSystemRole`는 "원하는 새 값"만이 아니라 "현재↔원하는 상태"를 비교한다(finding C).** `assertCanAssignRoles`는 `currentRoleKeys`↔`nextRoleKeys`의 **차집합(추가∪제거)** 중 특권 역할이 있으면, `assertCanSetSystemRole`은 **`currentRole` 또는 `newRole`** 이 OWNER/ADMIN이면 비-OWNER를 거부한다. 그래야 위임 admin이 ① 기존 OWNER/ADMIN을 강등하거나 ② 기존 pm/admin 역할을 목록에서 빼서 제거하는 lockout을 막는다. 따라서 호출자(service, task-04)는 **mutation 전에 대상의 현재 systemRole·roleKeys를 로드**해 넘겨야 한다(§S6 `getUserDetail`의 `systemRole`·`roleKeys`).
- **`assertOverrideWithinActorGrant`는 critical(`admin.*`) 권한을 effect와 무관하게 OWNER-only로 막는다(finding D).** ALLOW도 예외가 아니다 — 위임 admin이 `admin.users:update`·`admin.audit:view` 등을 **보유하고 있더라도** ALLOW override로 타인에게 동등 admin 권한을 부여할 수 없다(보호된 역할/systemRole 부여 없이 OWNER-only 위임 경계를 우회하는 것 방지). 비-critical 권한만 기존 로직(ALLOW=actor 보유 한도 내, DENY=허용)을 따른다. critical 판정은 `CRITICAL_RESOURCE_PREFIXES`(`admin.`) `startsWith` 매칭(`isCriticalKey`)으로 한다.
- **`computeDecision`은 scope="all" ALLOW만 전역 허가로 인정**한다(`decision.ts` 주석). `countAvailableByPermission`은 target 컨텍스트 없는 전역 카운트이므로 own/team/assigned ALLOW는 가용으로 치지 않는다 — 이는 보수적(fail-closed)이라 최소가용성 불변식을 더 강하게 보존한다(의도된 동작).
- **에러 매핑은 라우트(task-05) 책임**이다. 본 task는 throw만 하고 HTTP 상태로 변환하지 않는다.
- **surgical**: 기존 파일(`access/*`, `leave/*`)을 수정하지 않는다. 본 task는 신규 모듈 3개 + 테스트 2개만 추가한다.
- `permissionOverrides`를 조건부 `select`(permissionId 없으면 `false`)로 가져오므로, 코드에서 `u.permissionOverrides ?? []`로 안전 접근한다(타입상 select:false면 필드 부재).
