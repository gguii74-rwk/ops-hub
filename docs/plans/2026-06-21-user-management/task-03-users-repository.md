# Task 03 — admin/users repository + 메일 일반화

**Purpose:** `src/modules/admin/users/repositories/index.ts`에 사용자 수명주기의 모든 Prisma 접근(목록·상세·자가가입·승인/거절·편집·역할·override·상태전이·비번)을 모은다. status/role/override 전이는 leave `approveTx`의 status-CAS+`updatedAt` 낙관락을 그대로 따르고, 감사는 트랜잭션 내 기록한다. availability-affecting mutation은 task-02 `withAvailabilityLock`/`assertMinAvailability`로 감싼다. 사용자 메일을 공통 `MailDelivery`(`leaveRequestId=null`)로 enqueue하고, leave drain 워커를 `leaveRequestId`-optional로 **surgical하게** 일반화한다(leave 동작 완전 보존).

## Files
- Create: `src/modules/admin/users/repositories/index.ts`
- Create: `src/modules/admin/users/repositories/mail.ts`
- Modify: `src/modules/leave/repositories/mail.ts` (claimDelivery의 `leaveRequestId` null 거부 가드 제거 → nullable 허용)
- Modify: `src/modules/leave/services/mail.ts` (drain 루프에서 LeaveRequest 재확인을 `leaveRequestId` 있을 때만 수행)
- Create: `tests/modules/admin/users/repositories.test.ts`
- Create: `tests/modules/admin/users/mail-generalization.test.ts`

## Prep
- entrypoint §Shared Contracts: **S1**(스키마 필드명 — `passwordHash?`/`mustChangePassword`/`passwordChangedAt`/`sessionInvalidatedAt`/`emailVerifiedAt`/`emailVerifyTokenHash`/`emailVerifyExpiresAt`), **S5**(가드 시그니처 — import만, 재정의 금지), **S6**(이 task가 구현할 repository 시그니처 전부 — `createPendingSignup`/`refreshVerifyToken`은 `mail: UserMailJob` 인자 포함, `createPendingSignup`은 `pendingCap: number` 인자도 받음), **S8**(메일 일반화·`UserMailJob`/`UserMailEvent`). PENDING 상한은 `createPendingSignup`가 **`pendingCap` 인자로 주입받아** 트랜잭션 내에서 검사한다(상수 import 없음 — deps 역전 방지).
- spec 섹션 5(상태머신 전이 규칙), 섹션 9(트랜잭션·동시성·감사·메일), **D10**(중복 거부·만료 미검증 PENDING 교체)·**D11**(status-CAS)·**D14**(reset-password 세션무효화·최소가용성)·**D16**(이메일 검증·set-password 토큰).
- 패턴 참조(인라인됨, 재읽기 불필요): leave `approveTx`/`rejectRequest`/`cancelTx`/`updateByAdminTx`(`src/modules/leave/repositories/index.ts`), leave `insertPendingDelivery`/`claimDelivery`(`src/modules/leave/repositories/mail.ts`), `writeAudit`(`src/kernel/audit`), `prisma`/`PrismaTx`(`src/lib/prisma`).
- 테스트 모킹은 `tests/modules/leave/repositories.test.ts`의 `vi.hoisted` fake-db + `$transaction` 패스스루, `tests/modules/leave/mail-drain.test.ts`의 repo/prisma 모킹 패턴을 따른다.

## Deps
- 01 (스키마·Prisma Client: nullable `passwordHash`·새 User 필드·`@@index([status])`).
- 02 (`errors.ts`의 `UserConflictError`/`RateLimitError`, `guards.ts`의 `withAvailabilityLock`/`assertMinAvailability`).
- **06에 대한 의존 없음**(task 테이블: 03=01,02 / 06=01,03 — 03이 06보다 먼저). `createPendingSignup`의 PENDING 상한 검사는 `PENDING_UNVERIFIED_CAP` 상수를 import하지 않고 **`pendingCap: number` 인자로 주입받아** 트랜잭션 내에서 수행한다. `PENDING_UNVERIFIED_CAP` 상수는 task-06 `rate-limit.ts`가 소유하고, 라우트(task-06)가 `createPendingSignup` 호출 시 그 상수를 `pendingCap` 인자로 넘긴다(정상 방향 06→03). 이렇게 해서 03→06 import가 사라져 deps 역전·모듈 순환이 모두 해소된다.

## Steps

### 1. 실패 테스트 — repository (status-CAS·CRUD·세션무효화·가용성 락)

`tests/modules/admin/users/repositories.test.ts` — leave repositories.test.ts와 동일한 `vi.hoisted` fake-db 패턴. guards·mail·audit은 별도 단위로 검증하므로 호출 여부/인자만 단언(모킹).

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted로 fake db 선언 — mock factory는 hoisted되므로 동일 객체를 공유.
const h = vi.hoisted(() => {
  const db = {
    user: {
      findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(),
      create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    },
    accessRole: { findMany: vi.fn() },
    userAccessRole: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    userPermissionOverride: { create: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() },
    permission: { findUnique: vi.fn() },
    mailDelivery: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  // $executeRaw: cap advisory lock(pg_advisory_xact_lock) 호출 — 테스트에선 no-op. tx에도 동일 객체가 노출되므로 db에 둔다.
  (db as Record<string, unknown>).$executeRaw = vi.fn(async () => 1);
  const prisma = { ...db, $transaction: vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db)) };
  return { db, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
// guards: 가용성 락은 통과(콜백 즉시 실행), assertMinAvailability는 기본 no-op(통과).
const withAvailabilityLockMock = vi.fn(async (fn: (tx: unknown) => unknown) => fn(h.db));
const assertMinAvailabilityMock = vi.fn(async () => undefined);
vi.mock("@/modules/admin/users/services/guards", () => ({
  withAvailabilityLock: (...a: unknown[]) => (withAvailabilityLockMock as (...x: unknown[]) => unknown)(...a),
  assertMinAvailability: (...a: unknown[]) => assertMinAvailabilityMock(...a),
}));
const writeAuditMock = vi.fn();
vi.mock("@/kernel/audit", () => ({ writeAudit: (...a: unknown[]) => writeAuditMock(...a) }));

import {
  approveTx, rejectTx, updateUserTx, setRoles, createOverride, deleteOverride,
  setStatusTx, reactivateRejectedTx, resetPasswordTx, changePasswordTx,
  createActiveUserByAdminTx, createPendingSignup, setPasswordViaToken, refreshVerifyToken,
} from "@/modules/admin/users/repositories";
import { UserConflictError, RateLimitError, EscalationError } from "@/modules/admin/users/errors";
import { Prisma } from "@prisma/client";

// PENDING 상한은 라우트(task-06)가 주입하는 인자 — repository는 rate-limit.ts 상수에 의존하지 않는다(deps 역전 방지).
// 테스트는 임의의 cap 값을 pendingCap 인자로 직접 넘긴다(상수 import 없음).
const PENDING_CAP = 200;

beforeEach(() => {
  vi.clearAllMocks();
  withAvailabilityLockMock.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(h.db));
  assertMinAvailabilityMock.mockResolvedValue(undefined);
});

const mail = { recipients: ["a@x.com"], subject: "s", bodyHtml: "b" };

describe("approveTx", () => {
  const updatedAt = new Date("2026-06-01T00:00:00Z");
  const decision = { employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: ["developer"] };
  it("PENDING+검증완료면 ACTIVE 전이(CAS where=id+PENDING+updatedAt) + 역할확정 + 감사 + 메일 enqueue(leaveRequestId=null)", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "PENDING", emailVerifiedAt: new Date(), updatedAt });
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    h.db.accessRole.findMany.mockResolvedValue([{ id: "role-dev", key: "developer" }]);
    h.db.userAccessRole.findMany.mockResolvedValue([]);
    h.db.userAccessRole.createMany.mockResolvedValue({ count: 1 });
    h.db.userAccessRole.deleteMany.mockResolvedValue({ count: 0 });
    h.db.mailDelivery.create.mockResolvedValue({ id: "md1" });
    await approveTx("u1", "admin1", decision, mail, updatedAt);
    expect(h.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", status: "PENDING", updatedAt },
      data: expect.objectContaining({ status: "ACTIVE", employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER" }),
    }));
    expect(h.db.mailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaveRequestId: null, eventType: "APPROVED", recipients: ["a@x.com"], status: "PENDING" }),
    }));
    expect(writeAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorId: "admin1", entityType: "User", entityId: "u1", action: "approve",
    }));
  });
  it("이메일 미검증(emailVerifiedAt null)이면 UserConflictError, 메일 미enqueue", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "PENDING", emailVerifiedAt: null, updatedAt });
    await expect(approveTx("u1", "admin1", decision, mail, updatedAt)).rejects.toBeInstanceOf(UserConflictError);
    expect(h.db.user.updateMany).not.toHaveBeenCalled();
    expect(h.db.mailDelivery.create).not.toHaveBeenCalled();
  });
  it("이미 처리됨(status!=PENDING)이면 UserConflictError", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "ACTIVE", emailVerifiedAt: new Date(), updatedAt });
    await expect(approveTx("u1", "admin1", decision, mail, updatedAt)).rejects.toBeInstanceOf(UserConflictError);
  });
  it("CAS 충돌(updateMany count 0 — 더블승인/stale)이면 UserConflictError, 메일·역할 미반영", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "PENDING", emailVerifiedAt: new Date(), updatedAt });
    h.db.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(approveTx("u1", "admin1", decision, mail, updatedAt)).rejects.toBeInstanceOf(UserConflictError);
    expect(h.db.userAccessRole.createMany).not.toHaveBeenCalled();
    expect(h.db.mailDelivery.create).not.toHaveBeenCalled();
  });
});

describe("rejectTx", () => {
  const updatedAt = new Date("2026-06-01T00:00:00Z");
  it("PENDING→REJECTED(CAS) + 감사 + 거절 메일 enqueue", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "PENDING", updatedAt });
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    h.db.mailDelivery.create.mockResolvedValue({ id: "md1" });
    await rejectTx("u1", "admin1", "사유", mail, updatedAt);
    expect(h.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", status: "PENDING", updatedAt }, data: expect.objectContaining({ status: "REJECTED" }),
    }));
    expect(h.db.mailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaveRequestId: null, eventType: "REJECTED" }),
    }));
  });
  it("CAS 충돌이면 UserConflictError, 메일 미enqueue", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "PENDING", updatedAt });
    h.db.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(rejectTx("u1", "admin1", "사유", mail, updatedAt)).rejects.toBeInstanceOf(UserConflictError);
    expect(h.db.mailDelivery.create).not.toHaveBeenCalled();
  });
});

describe("setStatusTx (세션 무효화 동반)", () => {
  it("DISABLE: availability lock 안에서 sessionInvalidatedAt=now 갱신 + 커밋 전 assertMinAvailability", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "ACTIVE", updatedAt: new Date("2026-06-01T00:00:00Z") });
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date("2026-06-10T00:00:00Z");
    await setStatusTx("u1", "DISABLED", "admin1", now);
    expect(withAvailabilityLockMock).toHaveBeenCalled();
    expect(h.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DISABLED", sessionInvalidatedAt: now }),
    }));
    expect(assertMinAvailabilityMock).toHaveBeenCalled();
  });
  it("ENABLE: DISABLED→ACTIVE, sessionInvalidatedAt 미갱신(세션 무효화는 disable에만)", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "DISABLED", updatedAt: new Date("2026-06-01T00:00:00Z") });
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    await setStatusTx("u1", "ACTIVE", "admin1", new Date());
    const data = h.db.user.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("ACTIVE");
    expect(data.sessionInvalidatedAt).toBeUndefined();
  });
  it("최소 가용성 위반(assertMinAvailability throw)이면 전파(롤백)", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "ACTIVE", updatedAt: new Date("2026-06-01T00:00:00Z") });
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    assertMinAvailabilityMock.mockRejectedValue(new Error("min-availability"));
    await expect(setStatusTx("u1", "DISABLED", "admin1", new Date())).rejects.toThrow("min-availability");
  });
  it("finding 1: recheck를 락 안 fresh systemRole·roleKeys로 호출 — throw 시 변경 미수행", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "ACTIVE", updatedAt: new Date("2026-06-01T00:00:00Z"), systemRole: "ADMIN", roleAssignments: [{ role: { key: "admin" } }] });
    const recheck = vi.fn((t: { systemRole: string }) => { if (t.systemRole === "ADMIN") throw new EscalationError("특권 대상"); });
    await expect(setStatusTx("u1", "DISABLED", "admin1", new Date(), recheck)).rejects.toBeInstanceOf(EscalationError);
    expect(recheck).toHaveBeenCalledWith({ systemRole: "ADMIN", roleKeys: ["admin"] });
    expect(h.db.user.updateMany).not.toHaveBeenCalled();
  });
});

describe("resetPasswordTx (D14)", () => {
  // finding H: 락 안에서 findUnique로 fresh systemRole·roleKeys를 읽어 recheck 호출 후 reset.
  const freshTarget = { systemRole: "MEMBER", roleAssignments: [{ role: { key: "regular-developer" } }] };
  it("락 안 fresh state 재로드 → recheck → mustChangePassword=true + sessionInvalidatedAt=now + 감사, 커밋 전 assertMinAvailability", async () => {
    h.db.user.findUnique.mockResolvedValue(freshTarget);
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date("2026-06-10T00:00:00Z");
    const recheck = vi.fn();
    await resetPasswordTx("u1", "newhash", "admin1", now, recheck);
    expect(withAvailabilityLockMock).toHaveBeenCalled();
    expect(recheck).toHaveBeenCalledWith({ systemRole: "MEMBER", roleKeys: ["regular-developer"] }); // stale 아닌 락 안 fresh
    expect(h.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1" },
      data: expect.objectContaining({ passwordHash: "newhash", mustChangePassword: true, sessionInvalidatedAt: now }),
    }));
    expect(assertMinAvailabilityMock).toHaveBeenCalled();
    expect(writeAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "reset_password" }));
  });
  it("finding H: 대상이 락 안에서 특권(ADMIN)이면 recheck throw → reset·감사 미수행(임시비번 탈취 차단)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "ADMIN", roleAssignments: [] });
    const recheck = vi.fn((t: { systemRole: string }) => { if (t.systemRole === "ADMIN") throw new EscalationError("특권 대상"); });
    await expect(resetPasswordTx("u1", "newhash", "admin1", new Date(), recheck)).rejects.toBeInstanceOf(EscalationError);
    expect(h.db.user.updateMany).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
  it("대상 없음(findUnique null)이면 UserConflictError, updateMany 미호출", async () => {
    h.db.user.findUnique.mockResolvedValue(null);
    await expect(resetPasswordTx("u1", "newhash", "admin1", new Date())).rejects.toBeInstanceOf(UserConflictError);
    expect(h.db.user.updateMany).not.toHaveBeenCalled();
  });
  it("대상 행 없음(updateMany count 0)이면 UserConflictError", async () => {
    h.db.user.findUnique.mockResolvedValue(freshTarget);
    h.db.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(resetPasswordTx("u1", "newhash", "admin1", new Date())).rejects.toBeInstanceOf(UserConflictError);
  });
});

describe("changePasswordTx (D15 — 세션 무효화 기준은 passwordChangedAt)", () => {
  it("expectedCurrentHash CAS where + passwordHash + passwordChangedAt=now + mustChangePassword=false (finding 4)", async () => {
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date("2026-06-10T00:00:00Z");
    await changePasswordTx("u1", "newhash", now, "oldhash");
    expect(h.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", passwordHash: "oldhash" }, // 현재 해시 CAS — 그 사이 reset가 끼면 불일치
      data: { passwordHash: "newhash", passwordChangedAt: now, mustChangePassword: false },
    }));
  });
  it("finding 4: 검증~쓰기 사이 admin reset 등으로 현재 해시 불일치(count 0)면 UserConflictError(덮어쓰기 방지)", async () => {
    h.db.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(changePasswordTx("u1", "newhash", new Date(), "oldhash")).rejects.toBeInstanceOf(UserConflictError);
  });
  it("availability lock을 거치지 않는다(자가 변경은 가용성에 무관)", async () => {
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    await changePasswordTx("u1", "newhash", new Date(), "oldhash");
    expect(withAvailabilityLockMock).not.toHaveBeenCalled();
  });
});

describe("setRoles (idempotent + 가용성)", () => {
  it("createMany(skipDuplicates) + 차집합 deleteMany, availability lock·assertMinAvailability 경유", async () => {
    h.db.accessRole.findMany.mockResolvedValue([{ id: "role-dev", key: "developer" }]);
    h.db.userAccessRole.findMany.mockResolvedValue([{ roleId: "role-old" }]);
    h.db.userAccessRole.createMany.mockResolvedValue({ count: 1 });
    h.db.userAccessRole.deleteMany.mockResolvedValue({ count: 1 });
    await setRoles("u1", ["developer"], "admin1");
    expect(withAvailabilityLockMock).toHaveBeenCalled();
    expect(h.db.userAccessRole.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(h.db.userAccessRole.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: "u1", roleId: { in: ["role-old"] } }),
    }));
    expect(assertMinAvailabilityMock).toHaveBeenCalled();
  });
  it("알 수 없는 role key가 있으면 UserConflictError(존재 역할만 매핑)", async () => {
    h.db.accessRole.findMany.mockResolvedValue([]); // 'ghost' 미존재
    await expect(setRoles("u1", ["ghost"], "admin1")).rejects.toBeInstanceOf(UserConflictError);
  });
  it("finding H: recheck를 락 안 fresh currentRoleKeys로 호출 — 정상이면 applyRoles 진행", async () => {
    // userAccessRole.findMany 1차=recheck용(role.key), 2차=applyRoles 차집합용(roleId).
    h.db.userAccessRole.findMany
      .mockResolvedValueOnce([{ role: { key: "regular-developer" } }])
      .mockResolvedValueOnce([]);
    h.db.accessRole.findMany.mockResolvedValue([{ id: "role-cc", key: "contractor-content" }]);
    h.db.userAccessRole.createMany.mockResolvedValue({ count: 1 });
    h.db.userAccessRole.deleteMany.mockResolvedValue({ count: 0 });
    const recheck = vi.fn();
    await setRoles("u1", ["contractor-content"], "admin1", recheck);
    expect(recheck).toHaveBeenCalledWith(["regular-developer"]); // stale 스냅샷이 아니라 락 안 fresh 역할
    expect(h.db.userAccessRole.createMany).toHaveBeenCalled();
  });
  it("finding H: 락 안 fresh 역할에 특권이 끼면 recheck throw → applyRoles·감사 미수행(stale lockout 차단)", async () => {
    // 동시 OWNER action으로 대상이 pm을 갖게 된 상태를 fresh로 관측 → 위임 admin의 next(pm 제외)는 pm 제거 = 특권 회수 → recheck EscalationError.
    h.db.userAccessRole.findMany.mockResolvedValueOnce([{ role: { key: "pm" } }, { role: { key: "regular-developer" } }]);
    const recheck = vi.fn((cur: string[]) => { if (cur.includes("pm")) throw new EscalationError("특권 회수"); });
    await expect(setRoles("u1", ["regular-developer"], "admin1", recheck)).rejects.toBeInstanceOf(EscalationError);
    expect(h.db.userAccessRole.createMany).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});

describe("createOverride / deleteOverride (가용성)", () => {
  it("createOverride: permission 조회 후 override create + 감사, lock·assertMinAvailability 경유", async () => {
    h.db.permission.findUnique.mockResolvedValue({ id: "perm1" });
    h.db.userPermissionOverride.create.mockResolvedValue({ id: "ov1" });
    const res = await createOverride("u1", { resource: "leave.approval", action: "view", effect: "ALLOW", scope: "all", reason: "임시", startsAt: null, endsAt: null }, "admin1");
    expect(res).toEqual({ id: "ov1" });
    expect(withAvailabilityLockMock).toHaveBeenCalled();
    expect(h.db.userPermissionOverride.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "u1", permissionId: "perm1", effect: "ALLOW", scope: "all" }),
    }));
    expect(assertMinAvailabilityMock).toHaveBeenCalled();
  });
  it("알 수 없는 permission 키면 UserConflictError", async () => {
    h.db.permission.findUnique.mockResolvedValue(null);
    await expect(createOverride("u1", { resource: "x.y", action: "z", effect: "ALLOW", scope: "all", reason: null, startsAt: null, endsAt: null }, "admin1"))
      .rejects.toBeInstanceOf(UserConflictError);
  });
  it("deleteOverride: 본인 소유 override만 삭제(deleteMany), 0행이면 UserConflictError + lock", async () => {
    h.db.userPermissionOverride.deleteMany.mockResolvedValue({ count: 0 }); // 본인 소유 행 없음 → 충돌
    await expect(deleteOverride("u1", "ov1", "admin1")).rejects.toBeInstanceOf(UserConflictError);
    expect(withAvailabilityLockMock).toHaveBeenCalled();
  });
  it("deleteOverride 정상: deleteMany(where=id+userId) + 감사 + assertMinAvailability", async () => {
    h.db.userPermissionOverride.deleteMany.mockResolvedValue({ count: 1 });
    await deleteOverride("u1", "ov1", "admin1");
    expect(h.db.userPermissionOverride.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "ov1", userId: "u1" },
    }));
    expect(writeAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "delete_override" }));
    expect(assertMinAvailabilityMock).toHaveBeenCalled();
  });
});

describe("updateUserTx (systemRole 강등 시 가용성)", () => {
  const updatedAt = new Date("2026-06-01T00:00:00Z");
  it("일반 속성 patch(systemRole 미포함)는 가용성 락 없이 CAS 전이", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "ACTIVE", systemRole: "MEMBER", updatedAt });
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    await updateUserTx("u1", { name: "새이름" }, "admin1", updatedAt);
    expect(withAvailabilityLockMock).not.toHaveBeenCalled();
    expect(h.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", updatedAt }, data: expect.objectContaining({ name: "새이름" }),
    }));
  });
  it("systemRole 변경 patch면 availability lock·assertMinAvailability 경유", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "ACTIVE", systemRole: "OWNER", updatedAt });
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    await updateUserTx("u1", { systemRole: "MEMBER" }, "admin1", updatedAt);
    expect(withAvailabilityLockMock).toHaveBeenCalled();
    expect(assertMinAvailabilityMock).toHaveBeenCalled();
  });
  it("CAS 충돌(updatedAt mismatch → count 0)이면 UserConflictError", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "ACTIVE", systemRole: "MEMBER", updatedAt });
    h.db.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateUserTx("u1", { name: "x" }, "admin1", updatedAt)).rejects.toBeInstanceOf(UserConflictError);
  });
});

describe("createActiveUserByAdminTx (D4)", () => {
  const args = {
    email: "new@x.com", name: "신규", passwordHash: "h", employmentType: "REGULAR", jobFunction: "DEVELOPER",
    department: null, systemRole: "MEMBER", roleKeys: ["developer"], actorId: "admin1",
  };
  it("ACTIVE + mustChangePassword=true + emailVerifiedAt=now + 역할부여 + 감사", async () => {
    h.db.user.create.mockResolvedValue({ id: "u-new" });
    h.db.accessRole.findMany.mockResolvedValue([{ id: "role-dev", key: "developer" }]);
    h.db.userAccessRole.createMany.mockResolvedValue({ count: 1 });
    const res = await createActiveUserByAdminTx(args);
    expect(res).toEqual({ id: "u-new" });
    expect(h.db.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: "new@x.com", status: "ACTIVE", mustChangePassword: true, passwordHash: "h" }),
    }));
    const data = h.db.user.create.mock.calls[0][0].data;
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(writeAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "admin_create" }));
  });
  it("중복 이메일(P2002)이면 UserConflictError", async () => {
    h.db.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    await expect(createActiveUserByAdminTx(args)).rejects.toBeInstanceOf(UserConflictError);
  });
});

describe("createPendingSignup (C안 — 비번 없이 PENDING, user+mail 원자성 #4)", () => {
  const args = {
    email: "self@x.com", name: "자가", employmentType: "REGULAR", jobFunction: "DEVELOPER",
    department: null, tokenHash: "th", tokenExpiresAt: new Date("2026-07-01T00:00:00Z"),
    mail: { recipients: ["self@x.com"], subject: "verify", bodyHtml: "<a>link</a>" },
    pendingCap: PENDING_CAP, // 라우트가 주입하는 PENDING 상한 — repository는 인자로 받는다(deps 역전 방지)
  };
  it("PENDING 상한 미만 + 기존 행 없으면 PENDING 생성 + 검증메일 enqueue를 같은 트랜잭션에서(원자성) + cap advisory lock 선획득", async () => {
    h.db.user.count.mockResolvedValue(0);              // PENDING 상한 통과 — tx.user.count 트랜잭션 내 카운트
    h.db.user.findUnique.mockResolvedValue(null);
    h.db.user.create.mockResolvedValue({ id: "u-self" });
    h.db.mailDelivery.create.mockResolvedValue({ id: "md1" });
    const res = await createPendingSignup(args);
    expect(res).toEqual({ id: "u-self" });
    // finding B: cap 검사 전에 cap 전용 advisory lock(가용성 lock과 별개 키)을 획득해 동시 signup을 직렬화한다.
    expect((h.db as Record<string, ReturnType<typeof vi.fn>>).$executeRaw).toHaveBeenCalled();
    // finding B: cap count는 만료된 미검증 PENDING을 제외(emailVerifyExpiresAt > now) — stale 행이 cap을 영구 점유하지 않도록.
    expect(h.db.user.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "PENDING", emailVerifiedAt: null, emailVerifyExpiresAt: { gt: expect.any(Date) } }),
    }));
    expect(h.db.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: "self@x.com", status: "PENDING", passwordHash: null, emailVerifiedAt: null, emailVerifyTokenHash: "th" }),
    }));
    // 검증메일이 같은 트랜잭션에서 enqueue됨(leaveRequestId=null, VERIFY_EMAIL) — 부분실패로 메일 없는 PENDING 방지
    expect(h.db.mailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaveRequestId: null, eventType: "VERIFY_EMAIL", recipients: ["self@x.com"], status: "PENDING" }),
    }));
  });
  it("만료된 미검증 PENDING은 cap count에서 제외 — 만료 행이 있어도(cap count가 0이면) 신규 가입 허용 (finding B)", async () => {
    // cap count는 미만료(emailVerifyExpiresAt > now)만 세므로, 만료 행만 있는 경우 count는 0 → 상한 통과.
    // where에 emailVerifyExpiresAt:{gt:now}가 있어 만료 행이 제외됨을 신뢰하고, count mock은 그 조건의 결과(0)를 돌려준다.
    h.db.user.count.mockResolvedValue(0);
    h.db.user.findUnique.mockResolvedValue(null);
    h.db.user.create.mockResolvedValue({ id: "u-self" });
    h.db.mailDelivery.create.mockResolvedValue({ id: "md1" });
    const res = await createPendingSignup(args);
    expect(res).toEqual({ id: "u-self" });
    expect(h.db.user.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ emailVerifyExpiresAt: { gt: expect.any(Date) } }),
    }));
    expect(h.db.user.create).toHaveBeenCalled(); // 만료 행이 cap을 점유하지 않아 생성됨
  });
  it("만료된 미검증 PENDING이 있으면 동일 행을 교체(update) + 메일 재enqueue — D10·D16(멱등 재시도)", async () => {
    h.db.user.count.mockResolvedValue(0);
    h.db.user.findUnique.mockResolvedValue({ id: "u-old", status: "PENDING", emailVerifiedAt: null, emailVerifyExpiresAt: new Date("2026-05-01T00:00:00Z") });
    h.db.user.update.mockResolvedValue({ id: "u-old" });
    h.db.mailDelivery.create.mockResolvedValue({ id: "md1" });
    const res = await createPendingSignup(args);
    expect(res).toEqual({ id: "u-old" });
    expect(h.db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u-old" }, data: expect.objectContaining({ emailVerifyTokenHash: "th", status: "PENDING" }),
    }));
    expect(h.db.user.create).not.toHaveBeenCalled();
    // 교체 경로도 토큰·메일 재발급(같은 트랜잭션)
    expect(h.db.mailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaveRequestId: null, eventType: "VERIFY_EMAIL" }),
    }));
  });
  it("활성/검증완료/REJECTED 또는 만료 안 된 PENDING이면 UserConflictError(중복 거부), user·mail 미생성", async () => {
    h.db.user.count.mockResolvedValue(0);
    h.db.user.findUnique.mockResolvedValue({ id: "u-x", status: "ACTIVE", emailVerifiedAt: new Date(), emailVerifyExpiresAt: null });
    await expect(createPendingSignup(args)).rejects.toBeInstanceOf(UserConflictError);
    expect(h.db.user.create).not.toHaveBeenCalled();
    expect(h.db.user.update).not.toHaveBeenCalled();
    expect(h.db.mailDelivery.create).not.toHaveBeenCalled();
  });
  it("PENDING 상한(주입된 pendingCap) 도달이면 RateLimitError — user·mail 미생성(트랜잭션 내 cap 검사로 동시요청 cap 초과 방지 #3/B)", async () => {
    h.db.user.count.mockResolvedValue(PENDING_CAP); // 트랜잭션 안에서 capacity 관측(미만료 PENDING만, 인자로 받은 pendingCap과 비교)
    await expect(createPendingSignup(args)).rejects.toBeInstanceOf(RateLimitError);
    // cap 검사는 advisory lock 획득 후에 수행된다(직렬화) — 동시요청이 모두 cap 미만을 관측하는 race 방지.
    expect((h.db as Record<string, ReturnType<typeof vi.fn>>).$executeRaw).toHaveBeenCalled();
    expect(h.db.user.findUnique).not.toHaveBeenCalled();
    expect(h.db.user.create).not.toHaveBeenCalled();
    expect(h.db.mailDelivery.create).not.toHaveBeenCalled();
  });
});

describe("setPasswordViaToken (C안 set-password)", () => {
  it("유효 토큰이면 passwordHash+emailVerifiedAt 기록·토큰 소거(만료 검사 포함)", async () => {
    const now = new Date("2026-06-10T00:00:00Z");
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    h.db.user.findFirst.mockResolvedValue({ id: "u-self" });
    const res = await setPasswordViaToken("th", "newhash", now);
    expect(res).toEqual({ id: "u-self" });
    expect(h.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { emailVerifyTokenHash: "th", emailVerifyExpiresAt: { gt: now } },
      data: { passwordHash: "newhash", emailVerifiedAt: now, emailVerifyTokenHash: null, emailVerifyExpiresAt: null },
    }));
  });
  it("토큰 미일치/만료(count 0)면 null 반환", async () => {
    h.db.user.updateMany.mockResolvedValue({ count: 0 });
    expect(await setPasswordViaToken("bad", "h", new Date())).toBeNull();
  });
});

describe("refreshVerifyToken (재발송 — 토큰갱신 + 메일 재enqueue 원자성 #4)", () => {
  it("미검증 PENDING이면 새 토큰·만료 갱신 + 검증메일 재enqueue(같은 트랜잭션)", async () => {
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    h.db.user.findFirst.mockResolvedValue({ id: "u-self" });
    h.db.mailDelivery.create.mockResolvedValue({ id: "md1" });
    const res = await refreshVerifyToken("self@x.com", "th2", new Date("2026-07-01T00:00:00Z"), mail);
    expect(res).toEqual({ id: "u-self" });
    expect(h.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: "self@x.com", status: "PENDING", emailVerifiedAt: null },
      data: expect.objectContaining({ emailVerifyTokenHash: "th2" }),
    }));
    expect(h.db.mailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaveRequestId: null, eventType: "VERIFY_EMAIL" }),
    }));
  });
  it("대상 없으면 null, 메일 미enqueue", async () => {
    h.db.user.updateMany.mockResolvedValue({ count: 0 });
    expect(await refreshVerifyToken("none@x.com", "th", new Date(), mail)).toBeNull();
    expect(h.db.mailDelivery.create).not.toHaveBeenCalled();
  });
});

describe("reactivateRejectedTx", () => {
  it("REJECTED→ACTIVE(CAS) + sessionInvalidatedAt 미갱신", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "REJECTED", updatedAt: new Date("2026-06-01T00:00:00Z") });
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    await reactivateRejectedTx("u1", "admin1", new Date());
    expect(h.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", status: "REJECTED" }, data: expect.objectContaining({ status: "ACTIVE" }),
    }));
  });
  it("REJECTED 아니면 UserConflictError", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "ACTIVE", updatedAt: new Date() });
    await expect(reactivateRejectedTx("u1", "admin1", new Date())).rejects.toBeInstanceOf(UserConflictError);
  });
});
```

```
npm test -- tests/modules/admin/users/repositories   # expect FAIL (모듈 미존재)
```

### 2. 최소 구현 — 사용자 메일 타입/enqueue 헬퍼

`src/modules/admin/users/repositories/mail.ts` (S8):

```ts
import "server-only";
import type { PrismaTx } from "@/lib/prisma";

// 사용자 도메인 메일 본문 묶음(leave MailJob과 동형). 트랜잭션에 넘겨 enqueue.
export interface UserMailJob { recipients: string[]; subject: string; bodyHtml: string }
export type UserMailEvent = "APPROVED" | "REJECTED" | "VERIFY_EMAIL";

// 공통 MailDelivery에 사용자 메일을 enqueue — leaveRequestId=null(NULL은 @@unique([leaveRequestId,eventType]) 충돌을 일으키지 않음,
// Postgres unique는 NULL을 distinct로 취급 → 사용자 메일은 멱등키 없이 매번 새 행). eventType엔 UserMailEvent를 그대로 문자열로 저장.
export async function enqueueUserMail(
  tx: PrismaTx,
  args: { eventType: UserMailEvent } & UserMailJob,
): Promise<void> {
  await tx.mailDelivery.create({
    data: {
      leaveRequestId: null, eventType: args.eventType, status: "PENDING",
      recipients: args.recipients, subject: args.subject, bodyHtml: args.bodyHtml, attempts: 0,
    },
  });
}
```

### 3. 최소 구현 — repository

`src/modules/admin/users/repositories/index.ts` (S6). status/role/override CAS는 leave `approveTx` 패턴(`findUnique`→`updateMany({where:{id,status,updatedAt}})`→`count===0`→`UserConflictError`). availability-affecting mutation은 `withAvailabilityLock` 래퍼 + 커밋 전 `assertMinAvailability(tx)`.

```ts
import "server-only";
import { Prisma, type UserStatus } from "@prisma/client";
import { prisma, type PrismaTx } from "@/lib/prisma";
import { UserConflictError, RateLimitError } from "../errors";
import { withAvailabilityLock, assertMinAvailability } from "../services/guards";
import { writeAudit } from "@/kernel/audit";
import { enqueueUserMail, type UserMailJob } from "./mail";

// ── 타입 ──
export interface UserListFilter { status?: UserStatus; employmentType?: string; jobFunction?: string; q?: string; page: number; pageSize: number; }
export interface UserRow {
  id: string; email: string; name: string; status: UserStatus;
  employmentType: string; jobFunction: string; systemRole: string; department: string | null;
  roleKeys: string[]; createdAt: Date;
}
export interface OverrideRow { id: string; resource: string; action: string; effect: string; scope: string; reason: string | null; startsAt: Date | null; endsAt: Date | null; }
export interface UserDetail extends UserRow { mustChangePassword: boolean; emailVerifiedAt: Date | null; updatedAt: Date; overrides: OverrideRow[]; }
export interface OverrideInput { resource: string; action: string; effect: "ALLOW" | "DENY"; scope: string; reason: string | null; startsAt: Date | null; endsAt: Date | null; }

// roleKeys → AccessRole.id 매핑. 모든 키가 존재해야 함(없으면 충돌). tx/전역 어느 클라이언트로도 호출 가능.
async function resolveRoleIds(client: PrismaTx, roleKeys: string[]): Promise<string[]> {
  if (roleKeys.length === 0) return [];
  const roles = await client.accessRole.findMany({ where: { key: { in: roleKeys } }, select: { id: true, key: true } });
  if (roles.length !== new Set(roleKeys).size) throw new UserConflictError("알 수 없는 역할이 포함되어 있습니다.");
  return roles.map((r) => r.id);
}

// 역할 집합 확정(idempotent): createMany(skipDuplicates) + 목표에 없는 기존 배정 deleteMany(차집합). 트랜잭션 내 호출.
async function applyRoles(tx: PrismaTx, userId: string, roleKeys: string[]): Promise<void> {
  const roleIds = await resolveRoleIds(tx, roleKeys);
  await tx.userAccessRole.createMany({
    data: roleIds.map((roleId) => ({ userId, roleId })),
    skipDuplicates: true,
  });
  const existing = await tx.userAccessRole.findMany({ where: { userId }, select: { roleId: true } });
  const stale = existing.map((e) => e.roleId).filter((id) => !roleIds.includes(id));
  if (stale.length > 0) await tx.userAccessRole.deleteMany({ where: { userId, roleId: { in: stale } } });
}

// ── 조회 ──
export async function listUsers(f: UserListFilter): Promise<{ rows: UserRow[]; total: number; pendingCount: number }> {
  const where: Prisma.UserWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.employmentType ? { employmentType: f.employmentType as Prisma.UserWhereInput["employmentType"] } : {}),
    ...(f.jobFunction ? { jobFunction: f.jobFunction as Prisma.UserWhereInput["jobFunction"] } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { email: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, pendingCount] = await Promise.all([
    prisma.user.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize,
      select: {
        id: true, email: true, name: true, status: true, employmentType: true, jobFunction: true,
        systemRole: true, department: true, createdAt: true,
        roleAssignments: { select: { role: { select: { key: true } } } },
      },
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: { status: "PENDING" } }),
  ]);
  return {
    rows: rows.map((u) => ({
      id: u.id, email: u.email, name: u.name, status: u.status,
      employmentType: u.employmentType, jobFunction: u.jobFunction, systemRole: u.systemRole,
      department: u.department, createdAt: u.createdAt, roleKeys: u.roleAssignments.map((ra) => ra.role.key),
    })),
    total, pendingCount,
  };
}

export async function getUserDetail(id: string): Promise<UserDetail | null> {
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, status: true, employmentType: true, jobFunction: true,
      systemRole: true, department: true, createdAt: true, updatedAt: true,
      mustChangePassword: true, emailVerifiedAt: true,
      roleAssignments: { select: { role: { select: { key: true } } } },
      permissionOverrides: {
        select: { id: true, effect: true, scope: true, reason: true, startsAt: true, endsAt: true,
          permission: { select: { resource: true, action: true } } },
      },
    },
  });
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, status: u.status,
    employmentType: u.employmentType, jobFunction: u.jobFunction, systemRole: u.systemRole,
    department: u.department, createdAt: u.createdAt, updatedAt: u.updatedAt,
    mustChangePassword: u.mustChangePassword, emailVerifiedAt: u.emailVerifiedAt,
    roleKeys: u.roleAssignments.map((ra) => ra.role.key),
    overrides: u.permissionOverrides.map((o) => ({
      id: o.id, resource: o.permission.resource, action: o.permission.action,
      effect: o.effect, scope: o.scope, reason: o.reason, startsAt: o.startsAt, endsAt: o.endsAt,
    })),
  };
}

// ── 자가가입(C안) ──
// 비번 없이 PENDING 생성. 충돌 시: (a) 만료된 미검증 PENDING이면 같은 행을 교체(D10·D16) (b) 그 외(활성·검증완료·REJECTED·미만료 PENDING)는 거부.
// finding #4: PENDING User + 검증메일 MailDelivery를 **같은 트랜잭션**에서 생성한다(부분실패로 메일 없는 PENDING 방지).
//            교체 경로도 토큰·메일을 재발급/재enqueue해 멱등 재시도가 동작하게 한다.
// finding #3/B: PENDING 상한 검사를 같은 트랜잭션 안에서 tx.user.count로 수행한다(standalone count 후 별도 생성 금지 —
//            동시 요청이 모두 capacity를 관측해 전역 cap을 초과하는 것 방지). 라우트는 별도 enquedue 트랜잭션을 두지 않는다.
//            **cap 검사+생성/교체를 race-safe하게**: 트랜잭션 시작에서 cap 전용 advisory lock(`pg_advisory_xact_lock(hashtext('signup-cap'))`)을
//            획득해 동시 signup을 직렬화한다 — read-committed에서 count→write 사이에 다른 signup이 끼어들어 모두 cap 미만을 관측하고
//            모두 insert하는 race(bounded-creation 불변식 초과)를 막는다. 이 키는 가용성용 `withAvailabilityLock`의 키(고정 상수
//            `4815162342`, S5)와 **별개**다(서로 다른 불변식을 직렬화하므로 키를 공유하면 안 됨). 락은 트랜잭션 종료(커밋/롤백) 시 자동 해제.
//            cap count는 **만료된 미검증 PENDING(`emailVerifyExpiresAt < now`)을 제외**한다(`emailVerifyExpiresAt > now`만 카운트) —
//            stale 만료 행이 별도 cleanup 전까지 cap을 영구 점유하는 것을 막는다(어차피 D10·D16상 교체 허용 대상).
// deps 역전 방지: 상한 값은 `PENDING_UNVERIFIED_CAP` 상수를 import하지 않고 `pendingCap` 인자로 주입받는다.
//            상수는 task-06 rate-limit.ts가 소유하고, 라우트(task-06)가 호출 시 `pendingCap: PENDING_UNVERIFIED_CAP`로 넘긴다(정상 방향 06→03).
export async function createPendingSignup(args: {
  email: string; name: string; employmentType: string; jobFunction: string; department: string | null;
  tokenHash: string; tokenExpiresAt: Date; mail: UserMailJob; pendingCap: number;
}): Promise<{ id: string }> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    // cap 전용 advisory lock — cap 검사+생성/교체 구간을 직렬화(가용성용 lock과 별개 키). 트랜잭션 종료 시 자동 해제.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('signup-cap'))`;
    // 전역 미검증 PENDING 상한 — User 생성과 같은 트랜잭션 스냅샷에서 관측(cap 초과 동시생성 차단). 상한 값은 인자로 주입받음.
    // 만료된 미검증 PENDING(emailVerifyExpiresAt < now)은 제외 — stale 행이 cap을 영구 점유하지 않도록(교체 대상이므로).
    const pending = await tx.user.count({
      where: { status: "PENDING", emailVerifiedAt: null, emailVerifyExpiresAt: { gt: now } },
    });
    if (pending >= args.pendingCap) throw new RateLimitError("현재 신규 가입을 받을 수 없습니다. 잠시 후 다시 시도해 주세요.");

    const existing = await tx.user.findUnique({
      where: { email: args.email },
      select: { id: true, status: true, emailVerifiedAt: true, emailVerifyExpiresAt: true },
    });
    const data = {
      name: args.name,
      employmentType: args.employmentType as Prisma.UserCreateInput["employmentType"],
      jobFunction: args.jobFunction as Prisma.UserCreateInput["jobFunction"],
      department: args.department,
      status: "PENDING" as const, passwordHash: null, emailVerifiedAt: null,
      emailVerifyTokenHash: args.tokenHash, emailVerifyExpiresAt: args.tokenExpiresAt,
    };
    let id: string;
    if (existing) {
      const replaceable = existing.status === "PENDING" && existing.emailVerifiedAt === null
        && existing.emailVerifyExpiresAt !== null && existing.emailVerifyExpiresAt < now;
      if (!replaceable) throw new UserConflictError("이미 등록된 이메일입니다.");
      await tx.user.update({ where: { id: existing.id }, data });
      id = existing.id;
    } else {
      const created = await tx.user.create({ data: { email: args.email, ...data } });
      id = created.id;
    }
    // 검증 메일을 같은 트랜잭션에서 enqueue — User 생성과 원자적(둘 다 커밋 or 둘 다 롤백).
    await enqueueUserMail(tx, { eventType: "VERIFY_EMAIL", ...args.mail });
    return { id };
  });
}

// set-password 토큰 소비: 만료 안 된 토큰 일치 행에 passwordHash+emailVerifiedAt 기록, 토큰 소거. PENDING 유지.
export async function setPasswordViaToken(tokenHash: string, passwordHash: string, now: Date): Promise<{ id: string } | null> {
  const { count } = await prisma.user.updateMany({
    where: { emailVerifyTokenHash: tokenHash, emailVerifyExpiresAt: { gt: now } },
    data: { passwordHash, emailVerifiedAt: now, emailVerifyTokenHash: null, emailVerifyExpiresAt: null },
  });
  if (count === 0) return null;
  const u = await prisma.user.findFirst({ where: { emailVerifiedAt: now }, select: { id: true } });
  return u ? { id: u.id } : null;
}

// 검증 메일 재발송: 미검증 PENDING의 토큰·만료 갱신 + 검증메일 재enqueue.
// finding #4: 토큰 갱신과 메일 재enqueue를 **같은 트랜잭션**에서 — 토큰만 갱신되고 메일이 빠지는 부분실패를 막는다(멱등 재발송).
export async function refreshVerifyToken(email: string, tokenHash: string, tokenExpiresAt: Date, mail: UserMailJob): Promise<{ id: string } | null> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { email, status: "PENDING", emailVerifiedAt: null },
      data: { emailVerifyTokenHash: tokenHash, emailVerifyExpiresAt: tokenExpiresAt },
    });
    if (count === 0) return null;
    const u = await tx.user.findFirst({ where: { email }, select: { id: true } });
    if (!u) return null;
    await enqueueUserMail(tx, { eventType: "VERIFY_EMAIL", ...mail });
    return { id: u.id };
  });
}

// ── 관리자 직접추가(D4) ──
export async function createActiveUserByAdminTx(args: {
  email: string; name: string; passwordHash: string; employmentType: string; jobFunction: string;
  department: string | null; systemRole: string; roleKeys: string[]; actorId: string;
}): Promise<{ id: string }> {
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: args.email, name: args.name, passwordHash: args.passwordHash,
          employmentType: args.employmentType as Prisma.UserCreateInput["employmentType"],
          jobFunction: args.jobFunction as Prisma.UserCreateInput["jobFunction"],
          department: args.department,
          systemRole: args.systemRole as Prisma.UserCreateInput["systemRole"],
          status: "ACTIVE", mustChangePassword: true, emailVerifiedAt: now,
        },
        select: { id: true },
      });
      await applyRoles(tx, created.id, args.roleKeys);
      await writeAudit(tx, { actorId: args.actorId, entityType: "User", entityId: created.id, action: "admin_create", metadata: { email: args.email, systemRole: args.systemRole, roleKeys: args.roleKeys } });
      return { id: created.id };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new UserConflictError("이미 등록된 이메일입니다.");
    throw e;
  }
}

// ── 승인/거절(D11 — status-CAS + 역할확정 + 감사 + 메일 enqueue) ──
export async function approveTx(
  id: string, actorId: string,
  decision: { employmentType: string; jobFunction: string; systemRole: string; roleKeys: string[] },
  mail: UserMailJob, expectedUpdatedAt: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id }, select: { status: true, emailVerifiedAt: true, updatedAt: true } });
    if (!u) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    if (u.status !== "PENDING") throw new UserConflictError("이미 처리된 신청입니다.");
    if (!u.emailVerifiedAt) throw new UserConflictError("이메일 검증(비밀번호 설정) 전에는 승인할 수 없습니다.");
    const updated = await tx.user.updateMany({
      where: { id, status: "PENDING", updatedAt: expectedUpdatedAt },
      data: {
        status: "ACTIVE",
        employmentType: decision.employmentType as Prisma.UserUpdateInput["employmentType"],
        jobFunction: decision.jobFunction as Prisma.UserUpdateInput["jobFunction"],
        systemRole: decision.systemRole as Prisma.UserUpdateInput["systemRole"],
      },
    });
    if (updated.count === 0) throw new UserConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
    await applyRoles(tx, id, decision.roleKeys);
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "approve", metadata: { systemRole: decision.systemRole, roleKeys: decision.roleKeys } });
    await enqueueUserMail(tx, { eventType: "APPROVED", ...mail });
  });
}

export async function rejectTx(id: string, actorId: string, reason: string, mail: UserMailJob, expectedUpdatedAt: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id }, select: { status: true, updatedAt: true } });
    if (!u) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    if (u.status !== "PENDING") throw new UserConflictError("이미 처리된 신청입니다.");
    const updated = await tx.user.updateMany({
      where: { id, status: "PENDING", updatedAt: expectedUpdatedAt },
      data: { status: "REJECTED" },
    });
    if (updated.count === 0) throw new UserConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "reject", metadata: { reason } });
    await enqueueUserMail(tx, { eventType: "REJECTED", ...mail });
  });
}

// ── 편집(CAS + systemRole 강등 시 가용성) ──
export async function updateUserTx(
  id: string,
  patch: { name?: string; department?: string | null; employmentType?: string; jobFunction?: string; systemRole?: string },
  actorId: string, expectedUpdatedAt: Date,
): Promise<void> {
  // systemRole 변경은 가용성에 영향(OWNER/관리자 강등) → 락 + 커밋 전 재검사. 그 외 속성 patch는 가용성 무관.
  const affectsAvailability = patch.systemRole !== undefined;
  const run = async (tx: PrismaTx) => {
    const u = await tx.user.findUnique({ where: { id }, select: { status: true, updatedAt: true } });
    if (!u) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    const updated = await tx.user.updateMany({
      where: { id, updatedAt: expectedUpdatedAt },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.department !== undefined ? { department: patch.department } : {}),
        ...(patch.employmentType !== undefined ? { employmentType: patch.employmentType as Prisma.UserUpdateInput["employmentType"] } : {}),
        ...(patch.jobFunction !== undefined ? { jobFunction: patch.jobFunction as Prisma.UserUpdateInput["jobFunction"] } : {}),
        ...(patch.systemRole !== undefined ? { systemRole: patch.systemRole as Prisma.UserUpdateInput["systemRole"] } : {}),
      },
    });
    if (updated.count === 0) throw new UserConflictError("처리 중 정보가 변경되었습니다. 다시 확인해 주세요.");
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "update", metadata: { patch } });
    if (affectsAvailability) await assertMinAvailability(tx);
  };
  if (affectsAvailability) await withAvailabilityLock(run);
  else await prisma.$transaction(run);
}

// 역할 집합 확정(가용성 — role 제거가 마지막 관리자를 떨어뜨릴 수 있음).
// finding H: anti-escalation 가드는 stale 스냅샷이 아니라 **락 안 fresh currentRoleKeys**로 재검사한다
// (UserAccessRole 쓰기는 User.updatedAt을 올리지 않아 CAS로 못 잡으므로 락 안 재로드가 필수).
// recheck(서비스가 actor 캡처 클로저로 주입)를 fresh 역할로 호출 — 위반 시 throw로 applyRoles 전 롤백.
export async function setRoles(
  id: string, roleKeys: string[], actorId: string,
  recheck?: (currentRoleKeys: string[]) => void,
): Promise<void> {
  await withAvailabilityLock(async (tx) => {
    if (recheck) {
      const cur = await tx.userAccessRole.findMany({ where: { userId: id }, select: { role: { select: { key: true } } } });
      recheck(cur.map((r) => r.role.key)); // EscalationError 시 applyRoles 전에 중단(트랜잭션 롤백)
    }
    await applyRoles(tx, id, roleKeys);
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "set_roles", metadata: { roleKeys } });
    await assertMinAvailability(tx);
  });
}

// override 생성(가용성 — DENY가 마지막 관리자를 lockout할 수 있음).
export async function createOverride(id: string, o: OverrideInput, actorId: string): Promise<{ id: string }> {
  return withAvailabilityLock(async (tx) => {
    const perm = await tx.permission.findUnique({ where: { resource_action: { resource: o.resource, action: o.action } }, select: { id: true } });
    if (!perm) throw new UserConflictError("알 수 없는 권한입니다.");
    const created = await tx.userPermissionOverride.create({
      data: { userId: id, permissionId: perm.id, effect: o.effect, scope: o.scope, reason: o.reason, startsAt: o.startsAt, endsAt: o.endsAt },
      select: { id: true },
    });
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "create_override", metadata: { resource: o.resource, action: o.action, effect: o.effect, scope: o.scope } });
    await assertMinAvailability(tx);
    return { id: created.id };
  });
}

// override 삭제(가용성 — ALLOW 제거가 관리자 권한을 떨어뜨릴 수 있음). 본인 소유 행만.
export async function deleteOverride(id: string, overrideId: string, actorId: string): Promise<void> {
  await withAvailabilityLock(async (tx) => {
    const { count } = await tx.userPermissionOverride.deleteMany({ where: { id: overrideId, userId: id } });
    if (count === 0) throw new UserConflictError("해당 권한 예외를 찾을 수 없습니다.");
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "delete_override", metadata: { overrideId } });
    await assertMinAvailability(tx);
  });
}

// ── 상태 전이(세션 무효화 동반·가용성) ──
// disable은 sessionInvalidatedAt=now로 기존 세션 즉시 무효화(D14·상태전이). enable은 무효화하지 않는다.
// finding 1: 특권 대상 판정(D14 동형)을 stale 스냅샷이 아니라 **락 안 fresh systemRole·roleKeys**로 재검사한다
// (위임 admin이 특권이 된 직후 대상을 disable해 세션을 무효화하는 race 차단). recheck를 fresh state로 호출 — throw 시 변경 전 롤백.
export async function setStatusTx(
  id: string, status: "ACTIVE" | "DISABLED", actorId: string, now: Date,
  recheck?: (target: { systemRole: string; roleKeys: string[] }) => void,
): Promise<void> {
  await withAvailabilityLock(async (tx) => {
    const u = await tx.user.findUnique({
      where: { id },
      select: { status: true, updatedAt: true, systemRole: true, roleAssignments: { select: { role: { select: { key: true } } } } },
    });
    if (!u) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    if (recheck) recheck({ systemRole: u.systemRole, roleKeys: u.roleAssignments.map((r) => r.role.key) }); // finding 1 — 변경 전 중단
    if (u.status === status) throw new UserConflictError("이미 해당 상태입니다.");
    const updated = await tx.user.updateMany({
      where: { id, status: u.status, updatedAt: u.updatedAt },
      data: { status, ...(status === "DISABLED" ? { sessionInvalidatedAt: now } : {}) },
    });
    if (updated.count === 0) throw new UserConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: status === "DISABLED" ? "disable" : "enable", metadata: {} });
    await assertMinAvailability(tx);
  });
}

// REJECTED→ACTIVE 재활성(관리자만). 세션 무효화 불필요(REJECTED는 로그인 불가였음).
export async function reactivateRejectedTx(
  id: string, actorId: string, now: Date,
  recheck?: (target: { systemRole: string; roleKeys: string[] }) => void,
): Promise<void> {
  await withAvailabilityLock(async (tx) => {
    const u = await tx.user.findUnique({
      where: { id },
      select: { status: true, updatedAt: true, systemRole: true, roleAssignments: { select: { role: { select: { key: true } } } } },
    });
    if (!u) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    if (recheck) recheck({ systemRole: u.systemRole, roleKeys: u.roleAssignments.map((r) => r.role.key) }); // finding 1
    if (u.status !== "REJECTED") throw new UserConflictError("거절 상태의 사용자만 재활성할 수 있습니다.");
    const updated = await tx.user.updateMany({
      where: { id, status: "REJECTED", updatedAt: u.updatedAt },
      data: { status: "ACTIVE" },
    });
    if (updated.count === 0) throw new UserConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "reactivate", metadata: { now } });
    await assertMinAvailability(tx);
  });
}

// ── 비밀번호(D14 reset / D15 change) ──
// reset(관리자): 임시비번 → mustChangePassword=true + sessionInvalidatedAt=now(기존 세션 무효화). 가용성 — 마지막 관리자를 must-change로 만들면 거부.
// finding H: 특권 대상 판정(D14)을 stale 스냅샷이 아니라 **락 안 fresh systemRole·roleKeys**로 재검사한다
// (대상이 특권이 된 직후 위임 admin이 reset해 임시비번을 탈취하는 race 차단). recheck를 fresh state로 호출 — 위반 시 throw로 reset 전 롤백.
export async function resetPasswordTx(
  id: string, passwordHash: string, actorId: string, now: Date,
  recheck?: (target: { systemRole: string; roleKeys: string[] }) => void,
): Promise<void> {
  await withAvailabilityLock(async (tx) => {
    const u = await tx.user.findUnique({
      where: { id },
      select: { systemRole: true, roleAssignments: { select: { role: { select: { key: true } } } } },
    });
    if (!u) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    if (recheck) recheck({ systemRole: u.systemRole, roleKeys: u.roleAssignments.map((r) => r.role.key) }); // EscalationError 시 reset 전 중단(롤백)
    const { count } = await tx.user.updateMany({
      where: { id },
      data: { passwordHash, mustChangePassword: true, sessionInvalidatedAt: now },
    });
    if (count === 0) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "reset_password", metadata: {} });
    await assertMinAvailability(tx);
  });
}

// change(자가/강제변경): passwordHash + passwordChangedAt=now(타 세션 무효화 기준) + mustChangePassword 해제. 가용성 무관(스스로 사용 가능 상태로 복귀).
// finding 4: expectedCurrentHash CAS — 라우트가 현재비번 검증에 쓴 해시를 where에 넣는다. 검증~쓰기 사이에 admin reset(또는 타 변경)이
// passwordHash를 바꾸면 count 0 → UserConflictError(이전 비번 사용자가 reset/must-change 복구를 덮어쓰는 race 차단). 라우트는 409로 재로그인 유도.
export async function changePasswordTx(id: string, passwordHash: string, now: Date, expectedCurrentHash: string): Promise<void> {
  const { count } = await prisma.user.updateMany({
    where: { id, passwordHash: expectedCurrentHash },
    data: { passwordHash, passwordChangedAt: now, mustChangePassword: false },
  });
  if (count === 0) throw new UserConflictError("처리 중 비밀번호가 변경되었습니다. 다시 로그인해 주세요.");
}
```

```
npm test -- tests/modules/admin/users/repositories   # expect PASS
```

### 4. 실패 테스트 — 메일 일반화(leave drain 보존 + 사용자 메일 발송)

`tests/modules/admin/users/mail-generalization.test.ts` — leave mail-drain.test.ts 패턴. leave 경로(leaveRequestId 있음)는 기존 재확인 유지, 사용자 경로(leaveRequestId=null)는 재확인 생략하고 바로 발송됨을 검증.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: vi.fn() }, leaveRequest: { findUnique: vi.fn() } } }));
vi.mock("@/kernel/access", () => ({ hasPermission: vi.fn() }));
vi.mock("@/modules/leave/repositories/mail", () => ({
  listDueDeliveryIds: vi.fn(), claimDelivery: vi.fn(), finalizeDelivery: vi.fn(), deadLetterStaleSending: vi.fn(),
}));
vi.mock("@/lib/integrations/mail", () => ({ sendMail: vi.fn() }));

import { drainLeaveMailOutbox } from "@/modules/leave/services/mail";
import * as repo from "@/modules/leave/repositories/mail";
import { sendMail } from "@/lib/integrations/mail";
import { prisma } from "@/lib/prisma";

const r = { list: vi.mocked(repo.listDueDeliveryIds), claim: vi.mocked(repo.claimDelivery), fin: vi.mocked(repo.finalizeDelivery), dead: vi.mocked(repo.deadLetterStaleSending) };
const send = vi.mocked(sendMail);

beforeEach(() => {
  vi.clearAllMocks();
  r.dead.mockResolvedValue(0);
});

describe("drain 일반화 — 사용자 메일(leaveRequestId=null)", () => {
  it("leaveRequestId가 null이면 LeaveRequest 재확인 없이 바로 발송", async () => {
    r.list.mockResolvedValue(["m1"]);
    // 일반화된 claim 결과: leaveRequestId null 허용
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: null, eventType: "APPROVED", recipients: ["self@x.com"], subject: "s", bodyHtml: "b" } as never);
    send.mockResolvedValue({ providerMessageId: "pm" });
    r.fin.mockResolvedValue(true);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 1, failed: 0, skipped: 0 });
    // 사용자 메일은 leaveRequest를 조회하지 않는다
    expect(vi.mocked(prisma.leaveRequest.findUnique)).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ["self@x.com"] }));
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", { status: "SENT", providerMessageId: "pm" });
  });
});

describe("drain 보존 — leave 메일(leaveRequestId 있음)은 기존대로 재확인", () => {
  it("leaveRequestId가 있으면 발송 전 LeaveRequest status 재확인 수행", async () => {
    r.list.mockResolvedValue(["m2"]);
    r.claim.mockResolvedValue({ id: "m2", leaveRequestId: "r1", eventType: "APPROVED", recipients: ["x@x.com"], subject: "s", bodyHtml: "b" });
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: null, status: "APPROVED" } as never);
    send.mockResolvedValue({ providerMessageId: "pm" });
    r.fin.mockResolvedValue(true);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(vi.mocked(prisma.leaveRequest.findUnique)).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1" } }));
  });
  it("leaveRequestId 있고 status 불일치면 미발송 CANCELLED(기존 동작 보존)", async () => {
    r.list.mockResolvedValue(["m3"]);
    r.claim.mockResolvedValue({ id: "m3", leaveRequestId: "r1", eventType: "APPROVED", recipients: ["x@x.com"], subject: "s", bodyHtml: "b" });
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: null, status: "CANCELLED" } as never);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(r.fin).toHaveBeenCalledWith("m3", "w1", expect.objectContaining({ status: "CANCELLED" }));
  });
});
```

```
npm test -- tests/modules/admin/users/mail-generalization   # expect FAIL (claim null·drain 분기 미반영)
```

### 5. 최소 구현 — leave mail.ts·services/mail.ts 일반화 (surgical)

`src/modules/leave/repositories/mail.ts` 두 곳만 수정한다. **`dueWhere`·`cancelPendingDeliveries`·`deadLetterStaleSending`는 leave 스코프(`leaveRequestId not null`)를 그대로 유지** — 사용자 메일은 별도 due 후보 집합이 필요. 따라서 사용자 메일도 leave drain이 함께 처리하도록 `dueWhere`에서 leave 스코프 제약을 일반화한다.

먼저 `dueWhere`의 leave 한정 제거(사용자 메일도 후보가 되도록) — `eventType not null`만 유지:

```ts
// 후보 조건(claim/list 공유): 발송 가능 상태. leave/user 공통(eventType 있는 모든 outbox 행). 워크플로 행(eventType NULL)은 제외.
function dueWhere(now: Date) {
  return {
    eventType: { not: null },
    OR: [
      { status: "PENDING" as const },
      // FAILED는 backoff 경과분만 재후보 — lockedUntil(retry-not-before)이 null이거나 지났을 때.
      { status: "FAILED" as const, attempts: { lt: MAIL_MAX_ATTEMPTS }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      { status: "SENDING" as const, lockedUntil: { lt: now }, attempts: { lt: MAIL_MAX_ATTEMPTS } },
    ],
  };
}
```

> Note: `deadLetterStaleSending`는 `leaveRequestId: { not: null }`을 유지해도 사용자 메일을 누락하지 않게 일반화한다(아래). `cancelPendingDeliveries`는 `leaveRequestId`를 인자로 받아 그 행만 취소하므로 사용자 메일에 영향 없음 — 변경하지 않는다.

`deadLetterStaleSending`의 leave 한정 제거:

```ts
export async function deadLetterStaleSending(now: Date): Promise<number> {
  const { count } = await prisma.mailDelivery.updateMany({
    where: {
      eventType: { not: null },
      status: "SENDING", lockedUntil: { lt: now }, attempts: { gte: MAIL_MAX_ATTEMPTS },
    },
    data: { status: "FAILED", errorMessage: "최대 시도 초과(stale SENDING 회수 한도)", lockedUntil: null },
  });
  return count;
}
```

`ClaimedDelivery`의 `leaveRequestId`를 nullable로, `claimDelivery`에서 **null 거부 가드 제거**:

```ts
export interface ClaimedDelivery { id: string; leaveRequestId: string | null; eventType: string; recipients: string[]; subject: string; bodyHtml: string; }

export async function claimDelivery(id: string, workerId: string, now: Date): Promise<ClaimedDelivery | null> {
  const { count } = await prisma.mailDelivery.updateMany({
    where: { id, ...dueWhere(now) },
    data: { status: "SENDING", lockedUntil: new Date(now.getTime() + MAIL_LEASE_MS), workerId, attempts: { increment: 1 } },
  });
  if (count !== 1) return null;
  const d = await prisma.mailDelivery.findUnique({
    where: { id }, select: { id: true, leaveRequestId: true, eventType: true, recipients: true, subject: true, bodyHtml: true, workerId: true, status: true },
  });
  // leaveRequestId null 거부 가드 제거 — 사용자 메일(leaveRequestId=null)도 claim 허용. eventType not null은 dueWhere가 보장.
  if (!d || d.status !== "SENDING" || d.workerId !== workerId || !d.eventType) return null;
  return {
    id: d.id,
    leaveRequestId: d.leaveRequestId,
    eventType: d.eventType,
    recipients: Array.isArray(d.recipients) ? (d.recipients as string[]) : [],
    subject: d.subject,
    bodyHtml: d.bodyHtml ?? "",
  };
}
```

> `LeaveMailEvent` 타입은 유지하되 `ClaimedDelivery.eventType`은 `string`으로 넓힌다(사용자 이벤트 `VERIFY_EMAIL` 포함). drain 루프는 `leaveRequestId` 유무로 leave/user를 분기하므로 eventType의 정확 union은 leave 재확인 분기 내부에서만 의미가 있다.

`src/modules/leave/services/mail.ts` — drain 루프에서 **LeaveRequest 재확인·REQUESTED 수신자 재확정을 `leaveRequestId`가 있을 때만** 수행. 사용자 메일은 바로 발송. `EVENT_EXPECTED_STATUS` 조회는 leave 이벤트일 때만(타입 좁히기).

```ts
import "server-only";
import { randomUUID } from "node:crypto";
import type { LeaveRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/kernel/access";
import { sendMail } from "@/lib/integrations/mail";
import { listDueDeliveryIds, claimDelivery, finalizeDelivery, deadLetterStaleSending } from "../repositories/mail";

const DRAIN_BATCH = 50;

// leave 이벤트가 '발송 시점에 유효'하려면 신청이 가져야 할 현재 상태. 어긋나면 stale 통지 → 미발송.
const LEAVE_EVENT_EXPECTED_STATUS: Record<string, LeaveRequestStatus> = {
  REQUESTED: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  ADMIN_CREATED: "APPROVED",
};

// REQUESTED 통지 수신자(승인권한자) 발송 시점 재확정 — 기존 동작 보존.
export async function getLeaveAdminRecipients(): Promise<string[]> {
  const candidates = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, email: true },
  });
  const allowed = await Promise.all(
    candidates.map(async (u) => ((await hasPermission(u.id, "leave.approval", "view")) ? u.email : null)),
  );
  return allowed.filter((e): e is string => e !== null);
}

// 하이브리드 worker의 drain 1회. claim→(leave면 재확인)→발송→조건부 finalize. SMTP 실패만 FAILED, finalize 0행은 폐기.
export async function drainLeaveMailOutbox(workerId: string = randomUUID()): Promise<{ sent: number; failed: number; skipped: number }> {
  await deadLetterStaleSending(new Date());
  const ids = await listDueDeliveryIds(new Date(), DRAIN_BATCH);
  let sent = 0, failed = 0, skipped = 0;
  for (const id of ids) {
    const claimed = await claimDelivery(id, workerId, new Date());
    if (!claimed) { skipped++; continue; }

    let recipients = claimed.recipients;
    // ── leave 메일(leaveRequestId 있음): 발송 직전 신청 재확인·REQUESTED 수신자 재확정(기존 동작 완전 보존) ──
    if (claimed.leaveRequestId) {
      const req = await prisma.leaveRequest.findUnique({ where: { id: claimed.leaveRequestId }, select: { deletedAt: true, status: true } });
      if (!req || req.deletedAt) {
        await finalizeDelivery(id, workerId, { status: "CANCELLED", errorMessage: req ? "요청 삭제됨(발송 전 확인)" : "요청 없음(고아 outbox)" });
        skipped++; continue;
      }
      const expected = LEAVE_EVENT_EXPECTED_STATUS[claimed.eventType];
      if (expected && req.status !== expected) {
        await finalizeDelivery(id, workerId, { status: "CANCELLED", errorMessage: `상태 불일치(${claimed.eventType}↔${req.status}) — 미발송` });
        skipped++; continue;
      }
      if (claimed.eventType === "REQUESTED") recipients = await getLeaveAdminRecipients();
    }
    // ── 사용자 메일(leaveRequestId=null): 재확인 없이 스냅샷 수신자로 바로 발송 ──

    if (recipients.length === 0) {
      await finalizeDelivery(id, workerId, { status: "FAILED", errorMessage: "수신자 없음" });
      failed++; continue;
    }
    let providerMessageId: string | null = null;
    try {
      ({ providerMessageId } = await sendMail({ to: recipients, subject: claimed.subject, html: claimed.bodyHtml }));
    } catch (e) {
      await finalizeDelivery(id, workerId, { status: "FAILED", errorMessage: e instanceof Error ? e.message : String(e) });
      failed++; continue;
    }
    const ok = await finalizeDelivery(id, workerId, { status: "SENT", providerMessageId });
    if (ok) sent++; else skipped++;
  }
  return { sent, failed, skipped };
}

// fire-and-forget 트리거(작업 라우트가 커밋 후 호출). 사용자 메일도 같은 워커가 처리하므로 동명 트리거를 재사용(S8).
export function triggerLeaveMailDrain(): void {
  void drainLeaveMailOutbox().catch((e) => console.error("[mail] drain trigger failed", e));
}
```

> `listDueDeliveryIds`는 `dueWhere`를 그대로 쓰므로 위 `dueWhere` 일반화로 사용자 메일도 후보가 된다 — 추가 수정 없음. `LeaveMailEvent` export는 다른 소비자(mail.ts 자체)에서 유지되므로 제거하지 않는다.

```
npm test -- tests/modules/admin/users/mail-generalization   # expect PASS
npm test -- tests/modules/leave/mail-drain                  # expect PASS (leave 회귀 — 기존 케이스 그대로)
```

### 6. 커밋

```
git add src/modules/admin/users/repositories src/modules/leave/repositories/mail.ts src/modules/leave/services/mail.ts tests/modules/admin/users/repositories.test.ts tests/modules/admin/users/mail-generalization.test.ts
git commit -m "feat(user-mgmt): admin/users repository(status-CAS·세션무효화·가용성)·공통 메일 일반화(D11·D14·D16)"
```

## Acceptance Criteria
- `npm test -- tests/modules/admin/users/repositories` → PASS. 특히 **`createPendingSignup`이 user 생성·만료 PENDING 교체·검증메일 enqueue를 한 트랜잭션에서**(둘 다 생성 or 둘 다 롤백, finding #4), **PENDING 상한 도달 시 `RateLimitError`로 user·mail 미생성**(트랜잭션 내 `tx.user.count`, finding #3), **cap 검사 전 cap 전용 advisory lock 선획득·만료 미검증 PENDING은 cap count 제외**(finding B), **`refreshVerifyToken`이 토큰 갱신 + 메일 재enqueue를 멱등하게** 수행함을 단언.
- `npm test -- tests/modules/admin/users/mail-generalization` → PASS.
- `npm test -- tests/modules/leave/mail-drain` 및 `npm test -- tests/modules/leave/mail-outbox` → PASS (leave 메일 회귀 없음).
- `npm run typecheck` → 그린(에러 0).
- `npm run lint` → 그린(`src/modules/admin/users/repositories`가 Prisma를 직접 접근하는 repository 레이어이므로 boundaries 위반 없음 — leave repository와 동일 위치 규약).
- `npm test` 전체 → PASS.

## Cautions
- **Don't leave drain 동작을 깨지 마라.** Reason: `leaveRequestId`가 있는 행은 반드시 발송 전 LeaveRequest 재확인(deletedAt·status 일치)과 REQUESTED 수신자 재확정을 **기존대로** 거쳐야 한다. drain 루프 분기는 `if (claimed.leaveRequestId)` 안에만 leave 재확인을 두고, 사용자 메일(null)은 그 분기를 건너뛴다. leave 케이스의 미발송/CANCELLED/FAILED 종결 경로를 한 줄도 바꾸지 말 것 — `tests/modules/leave/mail-drain.test.ts`가 회귀 가드다.
- **Don't `dueWhere`에서 `eventType: { not: null }`을 빼지 마라.** Reason: 그게 workflow 행(eventType NULL)을 후보에서 제외하는 유일한 제약이다. leave 스코프(`leaveRequestId not null`)만 제거하고 `eventType not null`은 유지해야 사용자 메일은 포함, workflow 메일은 제외된다.
- **Don't `claimDelivery`에서 `eventType` 가드까지 제거하지 마라.** Reason: null 거부 가드는 `leaveRequestId`에 대한 것만 제거한다. `!d.eventType` 가드는 workflow 행 오claim을 막으므로 유지.
- **Don't status/role/override 전이를 단순 `update`로 하지 마라.** Reason: 동시 더블승인·stale 편집이 조용히 덮어쓴다. 반드시 `findUnique`로 `updatedAt` 스냅샷을 읽고 `updateMany({where:{id,status,updatedAt}})` + `count===0`이면 `UserConflictError`(leave `approveTx` 패턴, D11). 승인/거절 메일은 트랜잭션 내 1회 `enqueueUserMail`(=`mailDelivery.create`, `leaveRequestId=null`) — CAS가 더블승인을 막으므로 멱등키는 불필요.
- **Don't availability-affecting mutation에서 `withAvailabilityLock`/`assertMinAvailability`를 빼먹지 마라.** Reason: `setStatusTx`(disable)·`resetPasswordTx`·`setRoles`·`createOverride`/`deleteOverride`·`updateUserTx`(systemRole 변경)는 마지막 가용 관리자/감사조회자를 0으로 만들 수 있다(D13ⓔ·D14). 락 안에서 mutation 후 **커밋 전** `assertMinAvailability(tx)`를 호출해 위반 시 롤백한다. `changePasswordTx`는 자가 복귀라 가용성 무관 — 락 없이 단순 CAS.
- **Don't anti-escalation 가드를 stale 스냅샷으로만 검사하지 마라 — `setRoles`/`resetPasswordTx`는 락 안에서 fresh 상태로 재검사한다(finding H).** Reason: 서비스가 mutation 전에 로드한 `target`은 stale일 수 있다. 가드 통과~mutation 사이에 동시 OWNER action이 대상의 역할/특권을 바꾸면 stale 검사가 무력화된다(① OWNER가 방금 부여한 pm을 모르고 위임 admin이 목록에서 빼 lockout, ② 대상이 특권이 된 직후 reset해 임시비번 탈취). `User.updatedAt` CAS만으로는 **역할 변경(`UserAccessRole` 쓰기가 `User.updatedAt`을 안 올림)** 을 못 잡는다. `setRoles`는 락 안에서 `tx.userAccessRole.findMany`로 fresh currentRoleKeys를, `resetPasswordTx`/`setStatusTx`/`reactivateRejectedTx`는 `tx.user.findUnique`로 fresh `systemRole`·roleKeys를 재로드해 **recheck 콜백**(서비스가 actor 캡처 sync 클로저로 주입)을 호출한다(finding 1: 상태변경도 특권 대상 판정 재검사). recheck가 throw하면 applyRoles/updateMany 전에 트랜잭션이 롤백된다. `withAvailabilityLock`이 모든 가용성/역할/특권 mutation을 전역 직렬화하므로 재검사 시점에 동시 변경이 끼어들 수 없다. recheck 미주입(undefined)이면 재검사를 건너뛴다(내부 호출·테스트 호환).
- **Don't 세션 무효화 필드를 혼동하지 마라.** Reason: disable·reset-password는 `sessionInvalidatedAt=now`(상태/재설정 기준, D14), 비번 변경(change)은 `passwordChangedAt=now`(비번 기준, D15). 둘은 auth 콜백(task-07)에서 각각 `token.iat`와 비교되므로 잘못된 필드에 쓰면 무효화가 작동하지 않는다.
- **Don't S5 가드를 repository에서 재정의하지 마라.** Reason: `withAvailabilityLock`/`assertMinAvailability`는 task-02 `services/guards.ts`의 단일 정의를 import해 호출한다(advisory lock 키·가용성 카운트 로직은 거기 한 곳에). 이 task는 호출 측만 구현한다.
- **Don't `createPendingSignup`에서 미만료 PENDING/활성/REJECTED를 교체하지 마라.** Reason: 만료된 미검증 PENDING(`status==="PENDING" && emailVerifiedAt===null && emailVerifyExpiresAt < now`)만 교체 허용(D10·D16). 그 외 중복은 `UserConflictError`로 거부 — 이메일 영구 예약·검증완료 계정 탈취를 막는다.
- **Don't `createPendingSignup`/`refreshVerifyToken`에서 User 생성/토큰갱신과 검증메일 enqueue를 다른 트랜잭션으로 쪼개지 마라(finding #4).** Reason: PENDING User만 만들고 메일을 별도 트랜잭션으로 enqueue하면, 둘째 실패 시 메일 없는 PENDING이 남고 재시도가 중복으로 막혀 신청자가 토큰 만료까지 갇힌다. `mail: UserMailJob` 인자를 받아 **같은 `$transaction` 안에서** `enqueueUserMail(tx, { eventType:"VERIFY_EMAIL", ...mail })`까지 수행한다(둘 다 커밋 or 둘 다 롤백). 교체(만료 PENDING) 경로·재발송 경로도 메일을 재enqueue해 멱등 재시도가 동작하게 한다.
- **Don't PENDING 상한 검사를 별도 standalone `count` 후 생성으로 하지 마라(finding #3).** Reason: 라우트가 `count`를 따로 읽고 통과시키면 동시 요청이 모두 capacity 미만을 관측해 전역 cap을 초과한다. `createPendingSignup`이 **User 생성과 같은 트랜잭션 안에서** `tx.user.count({where:{status:"PENDING",emailVerifiedAt:null,emailVerifyExpiresAt:{gt:now}}})`를 읽고 `>= args.pendingCap`이면 `RateLimitError`를 던진다. 라우트에 `enforcePendingCap` 호출을 두지 않는다.
- **Don't cap 검사+생성을 직렬화 없이 두지 마라 — 그리고 만료 미검증 PENDING을 cap에 세지 마라(finding B).** Reason: read-committed에서 트랜잭션 안의 `count`라도 count→write 사이에 다른 signup이 끼어들어 모두 cap 미만을 관측하고 모두 insert하면 bounded-creation 불변식을 초과한다. 트랜잭션 시작에서 **cap 전용 advisory lock**(`tx.$executeRaw\`SELECT pg_advisory_xact_lock(hashtext('signup-cap'))\``)을 획득해 cap 검사+생성/교체 구간을 직렬화한다(또는 serializable+retry). 이 키는 가용성용 `withAvailabilityLock`의 고정 키(`4815162342`, S5)와 **반드시 별개**다 — 서로 다른 불변식을 직렬화하므로 키를 공유하면 signup과 가용성 mutation이 불필요하게 상호 차단된다. 또 cap count에서 **만료된 미검증 PENDING(`emailVerifyExpiresAt < now`)을 제외**(`emailVerifyExpiresAt: { gt: now }`만 카운트)한다 — stale 만료 행이 별도 cleanup 전까지 cap을 영구 점유해 신규 가입을 막는 것을 방지(만료 행은 어차피 D10·D16상 교체 허용 대상).
- **Don't `createPendingSignup`에서 `PENDING_UNVERIFIED_CAP` 상수를 import하지 마라(deps 역전 방지).** Reason: 상수는 task-06 `rate-limit.ts`가 소유한다 — repository(task-03)가 그 상수를 import하면 03→06 모듈 의존이 생겨 task 테이블 deps(03=01,02 / 06=01,03)와 역전·순환이 된다. 대신 `pendingCap: number`를 인자로 받고, 라우트(task-06)가 호출 시 `pendingCap: PENDING_UNVERIFIED_CAP`로 주입한다(정상 방향 06→03). repository가 `./errors`에서 `RateLimitError`를 import하는 것은 그대로 유지(task-02 소유).
- **Don't `setPasswordViaToken`/`refreshVerifyToken`을 `update`로 하지 마라.** Reason: 토큰 해시·만료를 `updateMany` where에 넣어 원자적으로 일치 검사한다(`emailVerifyExpiresAt: { gt: now }`). `count===0`이면 위조/만료로 보고 `null` 반환(예외 아님) — 라우트가 중립 응답(D16)을 내도록.
