# task-04 — admin/users service + validations

> 라우트가 호출하는 사용자 관리 고수준 서비스(S7)와 zod 스키마를 구현한다. 각 서비스 함수는 **(1) anti-escalation 가드(S5) → (2) repository(S6) 호출 → (3) 메일 enqueue·감사** 순으로 조합한다. 가드는 라우트 권한키 검사와 **별개로** 서비스 계층에서 강제한다(spec D13·§8).

## Files

**Create**
- `src/modules/admin/users/validations/index.ts` — **admin 전용** zod 스키마(S7): `adminCreateSchema`·`approveSchema`·`rejectSchema`·`updateUserSchema`·`rolesSchema`·`overrideSchema`. 비번 정책 `z.string().min(12)`. (공개·비번 스키마는 task-06/07 소관 — 중복 정의 금지.)
- `src/modules/admin/users/services/index.ts` — 고수준 서비스 함수(S7). 가드+repo+메일+감사 조합.

**Test**
- `tests/modules/admin/users/validations.test.ts`
- `tests/modules/admin/users/users-service.test.ts`

> Modify: 없음. 본 task는 신규 파일만 추가한다(기존 코드 surgical 미변경).

## Prep

읽기(맥락 확인용, 재인라인 금지 — entrypoint §Shared Contracts가 단일 진실원):

- entrypoint `docs/plans/2026-06-21-user-management.md` §S3(특권 상수)·§S4(에러)·§S5(가드/ActorContext)·§S6(repository 시그니처)·§S7(이 task가 구현)·§S8(메일).
- spec `docs/specs/2026-06-21-user-management-account-admin-design.md` §6(권한모델·D12/D13/D14)·§8(API 계약·"역할 부여 모든 라우트는 서비스 계층에서 D12/D13 동일 적용")·§9(감사·메일·트랜잭션).
- `src/modules/leave/services/requests.ts` — service가 repo+권한+메일을 조합하는 패턴(`getRequestById`→가드→`approveTx`→`triggerLeaveMailDrain`). 본 task는 동형으로 `getUserDetail`→가드→`approveTx`→trigger.
- `src/modules/leave/validations/index.ts` — zod 스키마·`superRefine` 패턴.
- `tests/modules/leave/requests-service.test.ts` — service 단위테스트 모킹 패턴(prisma·repository·guards·mail을 `vi.mock`, `vi.mocked`로 단언).
- 인라인 확인된 계약(재읽기 불필요):
  - 가드(task-02 `services/guards.ts`): `assertNotSelfMutation(actor,targetId)`·`assertCanAssignRoles(actor,roleKeys)`·`assertCanSetSystemRole(actor,newRole|null)`·`assertOverrideWithinActorGrant(actor,key,effect)`. 모두 sync, 위반 시 `EscalationError`. `permissionKey(resource,action)` 헬퍼도 동 파일에서 re-export.
  - `policy.ts`(task-02): `isPrivilegedRoleKey(key)`·`PRIVILEGED_SYSTEM_ROLES`(`["OWNER","ADMIN"]`).
  - repository(task-03 `repositories/index.ts`): `getUserDetail(id)`(반환에 `email`·`systemRole`·`roleKeys`·`updatedAt` 포함)·`listUsers(filter)`·`approveTx(id,actorId,decision,mail,expectedUpdatedAt)`·`rejectTx(id,actorId,reason,mail,expectedUpdatedAt)`·`createActiveUserByAdminTx(args)`·`updateUserTx(id,patch,actorId,expectedUpdatedAt)`·`setRoles(id,roleKeys,actorId)`·`createOverride(id,OverrideInput,actorId)`·`deleteOverride(id,overrideId,actorId)`·`setStatusTx(id,status,actorId,now)`·`reactivateRejectedTx(id,actorId,now)`·`resetPasswordTx(id,passwordHash,actorId,now)`.
  - 에러(task-02 `errors.ts`): `UserConflictError`·`UserValidationError`·`EscalationError`. (라우트가 HTTP 매핑 — task-05.)
  - 메일(task-03 `repositories/mail.ts`): `UserMailJob {recipients,subject,bodyHtml}`. 트리거는 `triggerLeaveMailDrain()`(공통, `src/modules/leave/services/mail.ts`, S8).
  - bcrypt: `import bcrypt from "bcryptjs"` (`src/lib/auth/index.ts`에서 `bcrypt.compare` 사용 중). 해시는 `bcrypt.hash(pw, 10)`.
  - enum 값: `SystemRole = OWNER|ADMIN|MANAGER|MEMBER`, `EmploymentType = REGULAR|CONTRACTOR`, `JobFunction = PM|DEVELOPER|CONTENT_MANAGER|CIVIL_RESPONSE`, `Scope = own|team|assigned|all`.
  - 역할 키(시드): `pm`·`regular-developer`·`contractor-developer`·`contractor-content`·`contractor-civil-response`·`admin`(task-01 신설).

## Deps

- **02** (가드·에러·정책): `assertNotSelfMutation`/`assertCanAssignRoles`/`assertCanSetSystemRole`/`assertOverrideWithinActorGrant`·`ActorContext`·`isPrivilegedRoleKey`·`PRIVILEGED_SYSTEM_ROLES`·`EscalationError`/`UserValidationError`.
- **03** (repository·메일): S6 함수 전부·`UserMailJob`·`getUserDetail` 반환 형상.

> 본 task 단위테스트는 repository·guards·prisma·mail·bcrypt를 모킹하므로 DB 없이 통과한다.

## TDD steps

> 규칙: 매 스텝 — 실패 테스트 작성 → 실행(expect FAIL) → 최소 구현 → 실행(expect PASS) → commit. 모든 코드 스텝은 전체 코드 인라인.

### Step 1 — validations 실패 테스트

`tests/modules/admin/users/validations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  adminCreateSchema, approveSchema, rejectSchema,
  updateUserSchema, rolesSchema, overrideSchema,
} from "@/modules/admin/users/validations";

// 공개 스키마(signupSchema/setPasswordSchema/resendSchema)는 task-06, changePasswordSchema는 task-07 소관 — 본 task에서 정의·테스트하지 않는다.

describe("approveSchema", () => {
  const ok = { employmentType: "CONTRACTOR", jobFunction: "CONTENT_MANAGER", systemRole: "MEMBER", roleKeys: ["contractor-content"] };
  it("정상 승인 입력 통과", () => {
    expect(approveSchema.safeParse(ok).success).toBe(true);
  });
  it("roleKeys 빈 배열 허용(역할 없이 승인 가능)", () => {
    expect(approveSchema.safeParse({ ...ok, roleKeys: [] }).success).toBe(true);
  });
  it("알 수 없는 systemRole 거부", () => {
    expect(approveSchema.safeParse({ ...ok, systemRole: "ROOT" }).success).toBe(false);
  });
});

describe("rejectSchema", () => {
  it("사유 필수(trim 후 빈 문자열 거부)", () => {
    expect(rejectSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(rejectSchema.safeParse({ reason: "중복 신청" }).success).toBe(true);
  });
});

describe("adminCreateSchema", () => {
  const ok = {
    email: "n@x.com", name: "신규", password: "abcdefghijkl",
    employmentType: "REGULAR", jobFunction: "DEVELOPER", department: null,
    systemRole: "MEMBER", roleKeys: ["regular-developer"],
  };
  it("정상 통과", () => {
    expect(adminCreateSchema.safeParse(ok).success).toBe(true);
  });
  it("임시비번 12자 미만 거부", () => {
    expect(adminCreateSchema.safeParse({ ...ok, password: "short" }).success).toBe(false);
  });
});

describe("updateUserSchema / rolesSchema", () => {
  it("updateUser 부분 patch — 빈 객체도 통과(변경 없음)", () => {
    expect(updateUserSchema.safeParse({}).success).toBe(true);
    expect(updateUserSchema.safeParse({ name: "수정", systemRole: "MANAGER" }).success).toBe(true);
  });
  it("updateUser 알 수 없는 systemRole 거부", () => {
    expect(updateUserSchema.safeParse({ systemRole: "ROOT" }).success).toBe(false);
  });
  it("rolesSchema roleKeys 배열", () => {
    expect(rolesSchema.safeParse({ roleKeys: ["developer", "admin"] }).success).toBe(true);
    expect(rolesSchema.safeParse({ roleKeys: "developer" }).success).toBe(false);
  });
});

describe("overrideSchema (resource:action 키·effect·scope·유효기간)", () => {
  const ok = { resource: "leave.approval", action: "view", effect: "ALLOW", scope: "all", reason: "임시 위임", startsAt: null, endsAt: null };
  it("정상 통과", () => {
    expect(overrideSchema.safeParse(ok).success).toBe(true);
  });
  it("알 수 없는 effect 거부", () => {
    expect(overrideSchema.safeParse({ ...ok, effect: "MAYBE" }).success).toBe(false);
  });
  it("알 수 없는 scope 거부", () => {
    expect(overrideSchema.safeParse({ ...ok, scope: "global" }).success).toBe(false);
  });
  it("ISO datetime 문자열 startsAt/endsAt 허용", () => {
    expect(overrideSchema.safeParse({ ...ok, startsAt: "2026-06-21T00:00:00.000Z", endsAt: "2026-12-31T00:00:00.000Z" }).success).toBe(true);
  });
});
```

실행: `npm test -- tests/modules/admin/users/validations.test.ts` → **FAIL**(모듈 미존재).

### Step 2 — validations 구현 (PASS)

`src/modules/admin/users/validations/index.ts`:

```ts
import { z } from "zod";

// 비밀번호 정책(시드 정책 재사용): 12자 이상.
const password = z.string().min(12, "비밀번호는 12자 이상이어야 합니다.");

// 신청·편집에 쓰는 속성 enum(schema.prisma와 일치).
const employmentType = z.enum(["REGULAR", "CONTRACTOR"]);
const jobFunction = z.enum(["PM", "DEVELOPER", "CONTENT_MANAGER", "CIVIL_RESPONSE"]);
const systemRole = z.enum(["OWNER", "ADMIN", "MANAGER", "MEMBER"]);
const overrideEffect = z.enum(["ALLOW", "DENY"]);
const overrideScope = z.enum(["own", "team", "assigned", "all"]);

const email = z.string().email("올바른 이메일 형식이 아닙니다.");
const name = z.string().trim().min(1, "이름은 필수입니다.").max(100);
const department = z.string().trim().max(100).nullish();
// 토큰·datetime은 문자열로 받고(라우트가 Date로 파싱), 빈 문자열은 거부.
const isoDateTime = z.string().datetime().nullish();

// 공개 자가가입(signupSchema)·set-password(setPasswordSchema)·재발송(resendSchema)은 task-06 `validations/signup.ts`,
// 비번 변경(changePasswordSchema)은 task-07 `validations/change-password.ts` 소관 — 본 파일에 정의 금지(중복 정의 충돌).

// ── 관리자 직접추가(D4): 임시비번 + 확정 속성·역할. ──
export const adminCreateSchema = z.object({
  email, name, password,
  employmentType, jobFunction, department,
  systemRole,
  roleKeys: z.array(z.string()).default([]),
});

// ── 승인(확정): 고용형태·직무·systemRole·역할 확정. roleKeys 빈 배열 허용. ──
export const approveSchema = z.object({
  employmentType, jobFunction, systemRole,
  roleKeys: z.array(z.string()).default([]),
});

// ── 거절: 사유 필수(trim 후 비어있으면 거부). ──
export const rejectSchema = z.object({
  reason: z.string().trim().min(1, "거절 사유는 필수입니다.").max(500),
});

// ── 편집(부분 patch): 전부 선택. systemRole 가드는 서비스가 강제(D12). ──
export const updateUserSchema = z.object({
  name: name.optional(),
  department,
  employmentType: employmentType.optional(),
  jobFunction: jobFunction.optional(),
  systemRole: systemRole.optional(),
});

// ── 역할 집합 확정. ──
export const rolesSchema = z.object({
  roleKeys: z.array(z.string()),
});

// ── 개인 override: 권한키(resource:action)·effect·scope·사유·유효기간. ──
export const overrideSchema = z.object({
  resource: z.string().min(1),
  action: z.string().min(1),
  effect: overrideEffect,
  scope: overrideScope,
  reason: z.string().trim().max(500).nullish(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
});

export type AdminCreateInput = z.infer<typeof adminCreateSchema>;
export type ApproveInput = z.infer<typeof approveSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type OverrideInputDto = z.infer<typeof overrideSchema>;
```

실행: `npm test -- tests/modules/admin/users/validations.test.ts` → **PASS**.

commit: `feat(user-mgmt): task-04 admin/users zod 스키마 (S7 admin 전용·비번 12자+)`

### Step 3 — service 실패 테스트 (가드·repo·메일 조합)

`tests/modules/admin/users/users-service.test.ts` — leave requests-service.test.ts 패턴. repository·guards·mail·bcrypt를 모킹하고 "가드 거부가 repo를 호출하지 않음 / 정상 경로가 repo+메일 호출 / 자가 mutation 거부 / 특권 부여 거부 / D14 특권 대상 reset OWNER-only"를 단언한다.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// repository(S6) 모킹.
vi.mock("@/modules/admin/users/repositories", () => ({
  getUserDetail: vi.fn(), listUsers: vi.fn(),
  approveTx: vi.fn(), rejectTx: vi.fn(), createActiveUserByAdminTx: vi.fn(),
  updateUserTx: vi.fn(), setRoles: vi.fn(), createOverride: vi.fn(), deleteOverride: vi.fn(),
  setStatusTx: vi.fn(), reactivateRejectedTx: vi.fn(), resetPasswordTx: vi.fn(),
}));
// 메일 트리거(공통) — no-op.
vi.mock("@/modules/leave/services/mail", () => ({ triggerLeaveMailDrain: vi.fn() }));
// bcrypt 해시 — 고정값(임시비번/새 비번 해시는 서비스가 만든다).
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "HASHED") } }));

import {
  approveUser, rejectUser, createUserByAdmin, updateUser, assignRoles,
  upsertOverride, removeOverride, setUserStatus, resetPassword, getUserForEdit, listUsersForView,
} from "@/modules/admin/users/services";
import * as repo from "@/modules/admin/users/repositories";
import { triggerLeaveMailDrain } from "@/modules/leave/services/mail";
import { EscalationError, UserConflictError } from "@/modules/admin/users/errors";
import type { ActorContext } from "@/modules/admin/users/services/guards";

const r = {
  getUserDetail: vi.mocked(repo.getUserDetail),
  listUsers: vi.mocked(repo.listUsers),
  approveTx: vi.mocked(repo.approveTx),
  rejectTx: vi.mocked(repo.rejectTx),
  createActiveUserByAdminTx: vi.mocked(repo.createActiveUserByAdminTx),
  updateUserTx: vi.mocked(repo.updateUserTx),
  setRoles: vi.mocked(repo.setRoles),
  createOverride: vi.mocked(repo.createOverride),
  deleteOverride: vi.mocked(repo.deleteOverride),
  setStatusTx: vi.mocked(repo.setStatusTx),
  reactivateRejectedTx: vi.mocked(repo.reactivateRejectedTx),
  resetPasswordTx: vi.mocked(repo.resetPasswordTx),
};
const trigger = vi.mocked(triggerLeaveMailDrain);

const owner: ActorContext = { userId: "owner1", isOwner: true, permissionKeys: new Set() };
const delegate = (keys: string[] = [], id = "admin1"): ActorContext => ({ userId: id, isOwner: false, permissionKeys: new Set(keys) });

// getUserDetail 기본 응답 헬퍼(승인/거절·편집 대상).
const detail = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "u1", email: "u@x.com", name: "대상", status: "PENDING",
  employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", department: null,
  roleKeys: [] as string[], createdAt: new Date(), updatedAt: new Date("2026-06-01T00:00:00Z"),
  mustChangePassword: false, emailVerifiedAt: new Date(), overrides: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  r.getUserDetail.mockResolvedValue(detail() as never);
});

describe("approveUser", () => {
  const input = { employmentType: "REGULAR" as const, jobFunction: "DEVELOPER" as const, systemRole: "MEMBER" as const, roleKeys: ["regular-developer"] };
  it("정상: approveTx(decision·mail[email]·updatedAt) 호출 + 메일 트리거", async () => {
    await approveUser(owner, "u1", input);
    expect(r.approveTx).toHaveBeenCalledWith(
      "u1", "owner1",
      expect.objectContaining({ systemRole: "MEMBER", roleKeys: ["regular-developer"] }),
      expect.objectContaining({ recipients: ["u@x.com"] }),
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(trigger).toHaveBeenCalled();
  });
  it("대상 없음 → UserConflictError, approveTx 미호출", async () => {
    r.getUserDetail.mockResolvedValue(null);
    await expect(approveUser(owner, "u1", input)).rejects.toBeInstanceOf(UserConflictError);
    expect(r.approveTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 승인 확정에서 특권 systemRole(ADMIN) 부여 → EscalationError, approveTx 미호출", async () => {
    await expect(approveUser(delegate(), "u1", { ...input, systemRole: "ADMIN" })).rejects.toBeInstanceOf(EscalationError);
    expect(r.approveTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 승인 확정에서 특권 역할(admin) 부여 → EscalationError, approveTx 미호출", async () => {
    await expect(approveUser(delegate(), "u1", { ...input, roleKeys: ["admin"] })).rejects.toBeInstanceOf(EscalationError);
    expect(r.approveTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 자기 자신을 승인(자가 mutation) → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1" }) as never);
    await expect(approveUser(delegate([], "admin1"), "admin1", input)).rejects.toBeInstanceOf(EscalationError);
    expect(r.approveTx).not.toHaveBeenCalled();
  });
});

describe("rejectUser", () => {
  it("정상: rejectTx(reason·mail[email]·updatedAt) + 트리거", async () => {
    await rejectUser(owner, "u1", "중복");
    expect(r.rejectTx).toHaveBeenCalledWith("u1", "owner1", "중복", expect.objectContaining({ recipients: ["u@x.com"] }), new Date("2026-06-01T00:00:00Z"));
    expect(trigger).toHaveBeenCalled();
  });
  it("위임 admin 자가 거절 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1" }) as never);
    await expect(rejectUser(delegate([], "admin1"), "admin1", "x")).rejects.toBeInstanceOf(EscalationError);
  });
});

describe("createUserByAdmin", () => {
  const input = {
    email: "n@x.com", name: "신규", password: "abcdefghijkl",
    employmentType: "REGULAR" as const, jobFunction: "DEVELOPER" as const, department: null,
    systemRole: "MEMBER" as const, roleKeys: ["regular-developer"],
  };
  it("정상: 비번 해시 후 createActiveUserByAdminTx(passwordHash) 호출", async () => {
    r.createActiveUserByAdminTx.mockResolvedValue({ id: "u-new" });
    const res = await createUserByAdmin(owner, input);
    expect(res).toEqual({ id: "u-new" });
    expect(r.createActiveUserByAdminTx).toHaveBeenCalledWith(expect.objectContaining({
      email: "n@x.com", passwordHash: "HASHED", systemRole: "MEMBER", actorId: "owner1", roleKeys: ["regular-developer"],
    }));
  });
  it("위임 admin이 특권 systemRole(OWNER) 직접추가 → EscalationError, repo 미호출", async () => {
    await expect(createUserByAdmin(delegate(), { ...input, systemRole: "OWNER" })).rejects.toBeInstanceOf(EscalationError);
    expect(r.createActiveUserByAdminTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 특권 역할(pm) 직접추가 → EscalationError, repo 미호출", async () => {
    await expect(createUserByAdmin(delegate(), { ...input, roleKeys: ["pm"] })).rejects.toBeInstanceOf(EscalationError);
    expect(r.createActiveUserByAdminTx).not.toHaveBeenCalled();
  });
});

describe("updateUser", () => {
  it("정상(비특권 patch): updateUserTx(patch·updatedAt) 호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE" }) as never);
    await updateUser(owner, "u1", { name: "수정" });
    expect(r.updateUserTx).toHaveBeenCalledWith("u1", { name: "수정" }, "owner1", new Date("2026-06-01T00:00:00Z"));
  });
  it("위임 admin이 자기 자신 편집 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1", status: "ACTIVE" }) as never);
    await expect(updateUser(delegate([], "admin1"), "admin1", { name: "x" })).rejects.toBeInstanceOf(EscalationError);
    expect(r.updateUserTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 systemRole을 ADMIN으로 변경 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE" }) as never);
    await expect(updateUser(delegate(), "u1", { systemRole: "ADMIN" })).rejects.toBeInstanceOf(EscalationError);
    expect(r.updateUserTx).not.toHaveBeenCalled();
  });
});

describe("assignRoles", () => {
  it("정상(비특권 역할): setRoles 호출", async () => {
    await assignRoles(delegate(), "u1", ["regular-developer"]);
    expect(r.setRoles).toHaveBeenCalledWith("u1", ["regular-developer"], "admin1");
  });
  it("위임 admin이 특권 역할(pm) 부여 → EscalationError", async () => {
    await expect(assignRoles(delegate(), "u1", ["pm"])).rejects.toBeInstanceOf(EscalationError);
    expect(r.setRoles).not.toHaveBeenCalled();
  });
  it("위임 admin이 자기 자신 역할 변경 → EscalationError", async () => {
    await expect(assignRoles(delegate([], "admin1"), "admin1", ["regular-developer"])).rejects.toBeInstanceOf(EscalationError);
    expect(r.setRoles).not.toHaveBeenCalled();
  });
});

describe("upsertOverride / removeOverride", () => {
  const ov = { resource: "leave.approval", action: "view", effect: "ALLOW" as const, scope: "all" as const, reason: null, startsAt: null, endsAt: null };
  it("ALLOW: actor 보유 권한이면 createOverride 호출", async () => {
    r.createOverride.mockResolvedValue({ id: "ov1" });
    const res = await upsertOverride(delegate(["leave.approval:view"]), "u1", ov);
    expect(res).toEqual({ id: "ov1" });
    expect(r.createOverride).toHaveBeenCalledWith("u1", expect.objectContaining({ resource: "leave.approval", action: "view", effect: "ALLOW" }), "admin1");
  });
  it("ALLOW: actor 미보유 권한이면 EscalationError, repo 미호출", async () => {
    await expect(upsertOverride(delegate([]), "u1", ov)).rejects.toBeInstanceOf(EscalationError);
    expect(r.createOverride).not.toHaveBeenCalled();
  });
  it("DENY: critical(admin.users:update)은 위임 admin 거부", async () => {
    await expect(upsertOverride(delegate(["admin.users:update"]), "u1", { ...ov, action: "update", resource: "admin.users", effect: "DENY" })).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 자기 자신 override → EscalationError", async () => {
    await expect(upsertOverride(delegate(["leave.approval:view"], "admin1"), "admin1", ov)).rejects.toBeInstanceOf(EscalationError);
  });
  it("removeOverride: 자가 아니면 deleteOverride 호출", async () => {
    await removeOverride(delegate(), "u1", "ov1");
    expect(r.deleteOverride).toHaveBeenCalledWith("u1", "ov1", "admin1");
  });
  it("removeOverride: 자가 mutation 거부", async () => {
    await expect(removeOverride(delegate([], "admin1"), "admin1", "ov1")).rejects.toBeInstanceOf(EscalationError);
    expect(r.deleteOverride).not.toHaveBeenCalled();
  });
});

describe("setUserStatus", () => {
  it("DISABLE: setStatusTx(now) 호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE" }) as never);
    await setUserStatus(owner, "u1", "DISABLED");
    expect(r.setStatusTx).toHaveBeenCalledWith("u1", "DISABLED", "owner1", expect.any(Date));
  });
  it("REJECTED 대상에 ACTIVE → reactivateRejectedTx 경로", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "REJECTED" }) as never);
    await setUserStatus(owner, "u1", "ACTIVE");
    expect(r.reactivateRejectedTx).toHaveBeenCalledWith("u1", "owner1", expect.any(Date));
    expect(r.setStatusTx).not.toHaveBeenCalled();
  });
  it("위임 admin 자가 status 변경 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1", status: "ACTIVE" }) as never);
    await expect(setUserStatus(delegate([], "admin1"), "admin1", "DISABLED")).rejects.toBeInstanceOf(EscalationError);
  });
});

describe("resetPassword (D14 — 특권 대상 OWNER-only)", () => {
  it("OWNER가 비특권 대상 재설정 → 임시비번 해시 후 resetPasswordTx + 결과 반환(임시비번 전달용)", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: [] }) as never);
    const res = await resetPassword(owner, "u1");
    expect(typeof res.tempPassword).toBe("string");
    expect(res.tempPassword.length).toBeGreaterThanOrEqual(12);
    expect(r.resetPasswordTx).toHaveBeenCalledWith("u1", "HASHED", "owner1", expect.any(Date));
  });
  it("위임 admin이 특권 대상(systemRole=ADMIN) 재설정 → EscalationError, repo 미호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "ADMIN", roleKeys: [] }) as never);
    await expect(resetPassword(delegate(), "u1")).rejects.toBeInstanceOf(EscalationError);
    expect(r.resetPasswordTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 특권 역할(pm) 보유 대상 재설정 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: ["pm"] }) as never);
    await expect(resetPassword(delegate(), "u1")).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 자기 자신 admin 라우트로 재설정 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1", status: "ACTIVE", systemRole: "MEMBER" }) as never);
    await expect(resetPassword(delegate([], "admin1"), "admin1")).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 비특권 대상 재설정 → 허용", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: ["regular-developer"] }) as never);
    await resetPassword(delegate(), "u1");
    expect(r.resetPasswordTx).toHaveBeenCalled();
  });
});

describe("getUserForEdit / listUsersForView (단순 위임)", () => {
  it("getUserForEdit: 대상 없으면 null", async () => {
    r.getUserDetail.mockResolvedValue(null);
    expect(await getUserForEdit(owner, "u1")).toBeNull();
  });
  it("listUsersForView: repo.listUsers로 위임", async () => {
    r.listUsers.mockResolvedValue({ rows: [], total: 0, pendingCount: 0 } as never);
    const res = await listUsersForView(owner, { page: 1, pageSize: 20 });
    expect(res).toEqual({ rows: [], total: 0, pendingCount: 0 });
    expect(r.listUsers).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });
});
```

실행: `npm test -- tests/modules/admin/users/users-service.test.ts` → **FAIL**(모듈 미존재).

### Step 4 — service 구현 (PASS)

`src/modules/admin/users/services/index.ts`:

```ts
import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  assertNotSelfMutation, assertCanAssignRoles, assertCanSetSystemRole, assertOverrideWithinActorGrant,
  permissionKey, type ActorContext,
} from "./guards";
import { isPrivilegedRoleKey, PRIVILEGED_SYSTEM_ROLES } from "../policy";
import { EscalationError, UserConflictError } from "../errors";
import {
  getUserDetail, listUsers,
  approveTx, rejectTx, createActiveUserByAdminTx, updateUserTx, setRoles,
  createOverride, deleteOverride, setStatusTx, reactivateRejectedTx, resetPasswordTx,
  type UserListFilter, type UserDetail, type OverrideInput,
} from "../repositories";
import type { UserMailJob } from "../repositories/mail";
import { triggerLeaveMailDrain } from "@/modules/leave/services/mail";
import type {
  AdminCreateInput, ApproveInput, UpdateUserInput, OverrideInputDto,
} from "../validations";

const BCRYPT_ROUNDS = 10;

// 임시 비밀번호 생성(reset/admin-add). 정책(12자+) 충족하는 URL-safe 난수. base64url 16바이트 → 22자.
function generateTempPassword(): string {
  return randomBytes(16).toString("base64url");
}

// 사용자 도메인 메일 본문 — 공통 MailDelivery로 enqueue할 {recipients,subject,bodyHtml}(S8).
// leave는 전용 mail-templates가 있으나 사용자 메일은 본 증분에서 본문이 단순(승인/거절 통지)하므로 서비스에서 직접 구성한다.
function buildApprovedMail(email: string, name: string): UserMailJob {
  return {
    recipients: [email],
    subject: "[ops-hub] 계정 가입이 승인되었습니다",
    bodyHtml: `<p>${name}님, ops-hub 계정 가입이 승인되었습니다. 이제 로그인하실 수 있습니다.</p>`,
  };
}
function buildRejectedMail(email: string, name: string, reason: string): UserMailJob {
  return {
    recipients: [email],
    subject: "[ops-hub] 계정 가입이 거절되었습니다",
    bodyHtml: `<p>${name}님, ops-hub 계정 가입 신청이 거절되었습니다.</p><p>사유: ${reason}</p>`,
  };
}

// 대상이 "특권"인지 — systemRole이 OWNER/ADMIN이거나 pm/admin 역할 보유(D14 reset-password 게이트).
function isPrivilegedTarget(target: { systemRole: string; roleKeys: string[] }): boolean {
  if ((PRIVILEGED_SYSTEM_ROLES as readonly string[]).includes(target.systemRole)) return true;
  return target.roleKeys.some(isPrivilegedRoleKey);
}

// 대상 조회 공통 — 없으면 충돌(라우트가 404/409 매핑). detail은 mutation 전 가드·메일·CAS 기준(updatedAt)에 쓴다.
async function loadTarget(id: string): Promise<UserDetail> {
  const target = await getUserDetail(id);
  if (!target) throw new UserConflictError("사용자를 찾을 수 없습니다.");
  return target;
}

// ── 조회(권한키는 라우트가 게이트. 서비스는 단순 위임). ──
export function listUsersForView(_actor: ActorContext, filter: UserListFilter) {
  return listUsers(filter);
}
export function getUserForEdit(_actor: ActorContext, id: string): Promise<UserDetail | null> {
  return getUserDetail(id);
}

// ── 승인(D11·D13ⓐⓑ·D12): 자가 금지 + 특권 역할/ systemRole 부여 가드 → approveTx(메일·CAS) → 트리거. ──
export async function approveUser(actor: ActorContext, id: string, input: ApproveInput): Promise<void> {
  const target = await loadTarget(id);
  assertNotSelfMutation(actor, id);
  assertCanSetSystemRole(actor, input.systemRole);
  assertCanAssignRoles(actor, input.roleKeys);
  const mail = buildApprovedMail(target.email, target.name);
  await approveTx(id, actor.userId, {
    employmentType: input.employmentType, jobFunction: input.jobFunction,
    systemRole: input.systemRole, roleKeys: input.roleKeys,
  }, mail, target.updatedAt);
  triggerLeaveMailDrain();
}

// ── 거절(D11·D13ⓐ): 자가 금지 → rejectTx(메일·CAS) → 트리거. ──
export async function rejectUser(actor: ActorContext, id: string, reason: string): Promise<void> {
  const target = await loadTarget(id);
  assertNotSelfMutation(actor, id);
  const mail = buildRejectedMail(target.email, target.name, reason);
  await rejectTx(id, actor.userId, reason, mail, target.updatedAt);
  triggerLeaveMailDrain();
}

// ── 직접추가(D4·D12·D13ⓑ): 특권 역할/systemRole 부여 가드 → 임시비번 해시 → createActiveUserByAdminTx. ──
export async function createUserByAdmin(actor: ActorContext, input: AdminCreateInput): Promise<{ id: string }> {
  assertCanSetSystemRole(actor, input.systemRole);
  assertCanAssignRoles(actor, input.roleKeys);
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  return createActiveUserByAdminTx({
    email: input.email, name: input.name, passwordHash,
    employmentType: input.employmentType, jobFunction: input.jobFunction, department: input.department ?? null,
    systemRole: input.systemRole, roleKeys: input.roleKeys, actorId: actor.userId,
  });
}

// ── 편집(D13ⓐ·D12): 자가 금지 + systemRole 변경 가드 → updateUserTx(CAS). ──
export async function updateUser(actor: ActorContext, id: string, patch: UpdateUserInput): Promise<void> {
  const target = await loadTarget(id);
  assertNotSelfMutation(actor, id);
  assertCanSetSystemRole(actor, patch.systemRole ?? null);
  await updateUserTx(id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.department !== undefined ? { department: patch.department ?? null } : {}),
    ...(patch.employmentType !== undefined ? { employmentType: patch.employmentType } : {}),
    ...(patch.jobFunction !== undefined ? { jobFunction: patch.jobFunction } : {}),
    ...(patch.systemRole !== undefined ? { systemRole: patch.systemRole } : {}),
  }, actor.userId, target.updatedAt);
}

// ── 역할 부여(D13ⓐ ⓑ): 자가 금지 + 특권 역할 가드 → setRoles(가용성은 repo가 보장). ──
export async function assignRoles(actor: ActorContext, id: string, roleKeys: string[]): Promise<void> {
  assertNotSelfMutation(actor, id);
  assertCanAssignRoles(actor, roleKeys);
  await setRoles(id, roleKeys, actor.userId);
}

// ── override 생성(D13ⓐ ⓒ ⓓ): 자가 금지 + ALLOW 보유한도/critical DENY 가드 → createOverride. ──
export async function upsertOverride(actor: ActorContext, id: string, dto: OverrideInputDto): Promise<{ id: string }> {
  assertNotSelfMutation(actor, id);
  assertOverrideWithinActorGrant(actor, permissionKey(dto.resource, dto.action), dto.effect);
  const input: OverrideInput = {
    resource: dto.resource, action: dto.action, effect: dto.effect, scope: dto.scope,
    reason: dto.reason ?? null,
    startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
    endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
  };
  return createOverride(id, input, actor.userId);
}

// ── override 삭제(D13ⓐ): 자가 금지 → deleteOverride(가용성은 repo가 보장). ──
export async function removeOverride(actor: ActorContext, id: string, overrideId: string): Promise<void> {
  assertNotSelfMutation(actor, id);
  await deleteOverride(id, overrideId, actor.userId);
}

// ── status 토글(D13ⓐ ⓔ): 자가 금지 → REJECTED→ACTIVE는 reactivate, 그 외 ACTIVE/DISABLED는 setStatus. ──
export async function setUserStatus(actor: ActorContext, id: string, status: "ACTIVE" | "DISABLED"): Promise<void> {
  const target = await loadTarget(id);
  assertNotSelfMutation(actor, id);
  const now = new Date();
  if (status === "ACTIVE" && target.status === "REJECTED") {
    await reactivateRejectedTx(id, actor.userId, now);
    return;
  }
  await setStatusTx(id, status, actor.userId, now);
}

// ── 비번 재설정(D14): 자가 금지 + 특권 대상은 OWNER-only → 임시비번 해시 → resetPasswordTx. 임시비번은 반환(관리자 전달용). ──
export async function resetPassword(actor: ActorContext, id: string): Promise<{ tempPassword: string }> {
  const target = await loadTarget(id);
  assertNotSelfMutation(actor, id);
  // 특권 대상(OWNER/ADMIN systemRole 또는 pm/admin 역할)은 OWNER만 재설정 가능(위임 admin 거부).
  if (!actor.isOwner && isPrivilegedTarget(target)) {
    throw new EscalationError("특권 사용자의 비밀번호 재설정은 OWNER만 가능합니다.");
  }
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
  await resetPasswordTx(id, passwordHash, actor.userId, new Date());
  return { tempPassword };
}
```

실행: `npm test -- tests/modules/admin/users/users-service.test.ts` → **PASS**.

commit: `feat(user-mgmt): task-04 admin/users service — 가드+repo+메일 조합 (S7 D12/D13/D14)`

### Step 5 — 전체 회귀·정합 확인 + 커밋

```bash
npm test -- tests/modules/admin/users   # validations·users-service + task-02/03 케이스 모두 PASS
npm run typecheck
npm run lint
```

commit(이미 분리 커밋했으면 생략 가능): `test(user-mgmt): task-04 service·validations 단위테스트 정합 확인`

## Acceptance Criteria

1. **단위테스트**
   ```bash
   npm test -- tests/modules/admin/users/validations tests/modules/admin/users/users-service
   ```
   기대: 두 파일 전 케이스 PASS, 실패 0. 출력 예 `Test Files  2 passed (2)` / `Tests  NN passed (NN)`.

2. **typecheck**
   ```bash
   npm run typecheck
   ```
   기대: 종료코드 0, 에러 0건. `services/index.ts`가 import하는 repo·guards·validations·mail 시그니처가 모두 일치(특히 `approveTx`/`rejectTx`/`createOverride`/`resetPasswordTx`의 인자 형상).

3. **전체 테스트(회귀)**
   ```bash
   npm test
   ```
   기대: 기존 leave/workflows/access 스위트 그대로 PASS(본 task는 신규 파일만 추가 — 회귀 0). task-02/03 admin/users 스위트도 PASS.

4. **lint**
   ```bash
   npm run lint
   ```
   기대: 신규 파일 boundaries 위반 없음. `services/index.ts`는 동일 모듈(`./guards`·`../policy`·`../errors`·`../repositories`·`../validations`)·`@/modules/leave/services/mail`(공통 메일 트리거, S8)·`bcryptjs`·`node:crypto`만 import. leave의 메일 트리거 재사용은 S8가 명시한 공통 경로다.

## Cautions

- **가드는 서비스 계층에서 강제(spec D13·§8) — 라우트 권한키와 별개.** `:create`/`:approve`/`:update` 권한키를 통과해도 `approveUser`/`createUserByAdmin`/`updateUser`/`assignRoles`/`upsertOverride`/`setUserStatus`/`resetPassword`는 반드시 본문 첫 부분에서 가드를 호출한다. **생성·승인도 역할 부여 경로**이므로 `assertCanSetSystemRole`+`assertCanAssignRoles`를 동일 적용한다(위임 admin이 `:create`/`:approve`로 `pm`/`admin`/`OWNER`/`ADMIN`을 부여·확정 못 함).
- **S5/S6 함수는 import 호출, 재정의 금지.** `withAvailabilityLock`/`assertMinAvailability`/최소가용성 카운트는 repository(task-03)가 mutation 내부에서 호출한다 — 서비스는 그 호출처를 만들지 않는다(중복 락 금지). 서비스는 sync 가드 4종 + D14 특권대상 검사만 자체 수행한다.
- **D14 특권 대상 reset-password는 서비스 전용 가드.** sync 가드 4종으로는 안 잡힌다(대상의 systemRole/역할을 조회해야 판정). `isPrivilegedTarget(target)` + `actor.isOwner` 조합으로 `EscalationError`. 비-OWNER가 자기 자신을 admin 라우트로 재설정하는 것은 `assertNotSelfMutation`이 먼저 막는다.
- **CAS 기준 `updatedAt`은 `getUserDetail`이 반환한 스냅샷을 그대로 repo에 넘긴다.** approve/reject/update가 stale read로 덮어쓰지 않게 — repo가 `where:{...,updatedAt}` 낙관락으로 `count===0` 충돌 검출(task-03). 서비스에서 별도 재조회·재계산하지 않는다.
- **임시비번/새 비번 해시는 서비스 책임, repo는 `passwordHash`만 받는다(task-03).** `bcrypt.hash(pw, 10)`. `resetPassword`는 평문 임시비번을 반환하되(관리자 화면 1회 표시·전달용, D4/D14) **DB·메일·로그에 평문을 남기지 않는다** — repo엔 해시만 전달.
- **메일은 승인/거절만(D5).** `approveTx`/`rejectTx` 트랜잭션 내 1회 enqueue는 repo가 하고(멱등키 불필요 — CAS가 더블승인 차단), 서비스는 `{recipients:[email],subject,bodyHtml}` 본문을 만들어 넘기고 커밋 후 `triggerLeaveMailDrain()`(fire-and-forget). status/role/override/reset 변경에는 메일을 보내지 않는다.
- **공개·비번 스키마는 task-06/07 소관(중복 정의 금지).** task-04 `validations/index.ts`는 **admin 전용**(`adminCreateSchema`·`approveSchema`·`rejectSchema`·`updateUserSchema`·`rolesSchema`·`overrideSchema`)만 둔다. `signupSchema`/`setPasswordSchema`/`resendSchema`는 task-06(`validations/signup.ts`), `changePasswordSchema`는 task-07(`validations/change-password.ts`)이 소유한다(S7). 마찬가지로 signup/set-password/resend/change-password **흐름**은 task-06/07 service 소관 — task-04 service는 approve/reject/createUserByAdmin/update/roles/override/setStatus/resetPassword/조회만 다룬다.
- **surgical**: 기존 leave/access 파일을 수정하지 않는다. 본 task는 신규 파일 2개 + 테스트 2개만. 메일 본문 빌더를 leave `mail-templates`에 끼워넣지 말 것(사용자 도메인 본문은 본 서비스에 둔다).
- **`status` 토글 분기**: `setStatusTx`는 `ACTIVE`/`DISABLED`만 받는다(task-03 시그니처). `REJECTED → ACTIVE` 재활성은 별도 `reactivateRejectedTx` 경로다 — 서비스가 대상 현재 status로 분기한다(잘못 호출 시 repo가 `UserConflictError`).
