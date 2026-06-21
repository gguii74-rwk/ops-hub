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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withAvailabilityLock: (...a: unknown[]) => (withAvailabilityLockMock as unknown as (...x: unknown[]) => unknown)(...(a as any[])),
  assertMinAvailability: (...a: unknown[]) => assertMinAvailabilityMock(...(a as Parameters<typeof assertMinAvailabilityMock>)),
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
  // clearAllMocks는 mockResolvedValueOnce 큐를 비우지 않는다(vitest 4: mockReset만 once 제거).
  // userAccessRole.findMany는 여러 테스트가 once 시퀀스를 쓰므로, 매 테스트 once 큐를 리셋하고 기본 []로 재설정해
  // 직전 테스트의 미소비 once가 누수되는 것을 막는다(각 테스트는 필요 시 mockResolvedValue(Once)로 override).
  h.db.userAccessRole.findMany.mockReset();
  h.db.userAccessRole.findMany.mockResolvedValue([]);
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
    // recheck 인자 미전달(기본 동작) → approveTx는 reload를 건너뛴다. applyRoles existing은 beforeEach 기본 []을 사용.
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
  // NF2: approveTx recheck — 트랜잭션 내 CAS 후 userAccessRole 리로드 → recheck(currentRoleKeys) 호출.
  it("NF2: recheck 통과하면 승인 진행(applyRoles·mail 호출됨)", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "PENDING", emailVerifiedAt: new Date(), updatedAt });
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    h.db.accessRole.findMany.mockResolvedValue([{ id: "role-dev", key: "developer" }]);
    h.db.userAccessRole.findMany
      .mockResolvedValueOnce([]) // recheck reload (현재 역할 없음 — 비특권)
      .mockResolvedValueOnce([]); // applyRoles existing
    h.db.userAccessRole.createMany.mockResolvedValue({ count: 1 });
    h.db.userAccessRole.deleteMany.mockResolvedValue({ count: 0 });
    h.db.mailDelivery.create.mockResolvedValue({ id: "md1" });
    const recheck = vi.fn();
    await approveTx("u1", "admin1", decision, mail, updatedAt, recheck);
    expect(recheck).toHaveBeenCalledWith([]); // fresh currentRoleKeys
    expect(h.db.userAccessRole.createMany).toHaveBeenCalled();
    expect(h.db.mailDelivery.create).toHaveBeenCalled();
  });
  it("NF2: recheck가 throw하면 applyRoles·mail 미호출(트랜잭션 롤백) — recheck는 fresh currentRoleKeys로 호출됨", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "PENDING", emailVerifiedAt: new Date(), updatedAt });
    // CAS updateMany는 count:1 반환(상태 업데이트 성공) — recheck에서 throw
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    // recheck용 userAccessRole.findMany: fresh에 특권 역할 pm이 있음
    h.db.userAccessRole.findMany.mockResolvedValueOnce([{ role: { key: "pm" } }]);
    const thrownError = new EscalationError("특권 역할 감지");
    const recheck = vi.fn((_currentRoleKeys: string[]) => { throw thrownError; });
    let caught: unknown;
    try { await approveTx("u1", "admin1", decision, mail, updatedAt, recheck); } catch (e) { caught = e; }
    expect(recheck).toHaveBeenCalledWith(["pm"]); // fresh currentRoleKeys로 호출됨
    expect(caught).toBe(thrownError); // EscalationError가 밖으로 전파됨
    expect(h.db.userAccessRole.createMany).not.toHaveBeenCalled();
    expect(h.db.mailDelivery.create).not.toHaveBeenCalled();
  });
  // NF3: approveTx가 availability lock 안에서 실행됨을 검증 — setRoles/setStatusTx와 동일한 advisory lock으로 직렬화.
  // 크로스-프로세스 실제 직렬화는 단위 테스트로 검증 불가; lock 획득 경로를 통과하는지가 테스트 가능한 proxy(setRoles·setStatusTx와 동일 패턴).
  it("NF3: approveTx는 availability lock 안에서 실행된다 — setRoles와 advisory lock 공유로 동시 특권역할 erase race 차단", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "PENDING", emailVerifiedAt: new Date(), updatedAt });
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    h.db.accessRole.findMany.mockResolvedValue([{ id: "role-dev", key: "developer" }]);
    h.db.userAccessRole.createMany.mockResolvedValue({ count: 1 });
    h.db.userAccessRole.deleteMany.mockResolvedValue({ count: 0 });
    h.db.mailDelivery.create.mockResolvedValue({ id: "md1" });
    await approveTx("u1", "admin1", decision, mail, updatedAt);
    expect(withAvailabilityLockMock).toHaveBeenCalled();
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
      where: { id: "u1", status: "PENDING", updatedAt },
      // F3 regression: 거절 시 verify 토큰 필드 소거 확인
      data: expect.objectContaining({ status: "REJECTED", emailVerifyTokenHash: null, emailVerifyExpiresAt: null }),
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
  // F2 regression: PENDING 상태 사용자는 status toggle 대상이 아님 — updateMany 미호출
  it("F2: 현재 status가 PENDING이면 UserConflictError, updateMany 미호출(승인우회 차단)", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "PENDING", updatedAt: new Date("2026-06-01T00:00:00Z"), systemRole: "MEMBER", roleAssignments: [] });
    await expect(setStatusTx("u1", "ACTIVE", "admin1", new Date())).rejects.toBeInstanceOf(UserConflictError);
    expect(h.db.user.updateMany).not.toHaveBeenCalled();
  });
  it("F2: 현재 status가 INVITED이면 UserConflictError, updateMany 미호출", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "INVITED", updatedAt: new Date("2026-06-01T00:00:00Z"), systemRole: "MEMBER", roleAssignments: [] });
    await expect(setStatusTx("u1", "ACTIVE", "admin1", new Date())).rejects.toBeInstanceOf(UserConflictError);
    expect(h.db.user.updateMany).not.toHaveBeenCalled();
  });
  it("F2: 현재 status가 REJECTED이면 UserConflictError, updateMany 미호출", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "REJECTED", updatedAt: new Date("2026-06-01T00:00:00Z"), systemRole: "MEMBER", roleAssignments: [] });
    await expect(setStatusTx("u1", "ACTIVE", "admin1", new Date())).rejects.toBeInstanceOf(UserConflictError);
    expect(h.db.user.updateMany).not.toHaveBeenCalled();
  });
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
  it("expectedCurrentHash + status=ACTIVE CAS where + passwordHash + passwordChangedAt=now + mustChangePassword=false (finding 4·F-RACE)", async () => {
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date("2026-06-10T00:00:00Z");
    await changePasswordTx("u1", "newhash", now, "oldhash");
    expect(h.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", passwordHash: "oldhash", status: "ACTIVE" }, // 현재 해시 + 활성 CAS — reset/disable이 끼면 불일치
      data: { passwordHash: "newhash", passwordChangedAt: now, mustChangePassword: false },
    }));
  });
  it("finding 4·F-RACE: 검증~쓰기 사이 admin reset(해시변경) 또는 disable(status≠ACTIVE)로 count 0면 UserConflictError(비활성 계정에 비번 박힘·덮어쓰기 방지)", async () => {
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
  it("중복 override(P2002 — @@unique[userId,permissionId,scope])이면 UserConflictError(500 아님)", async () => {
    h.db.permission.findUnique.mockResolvedValue({ id: "perm1" });
    h.db.userPermissionOverride.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }),
    );
    await expect(createOverride("u1", { resource: "leave.approval", action: "view", effect: "ALLOW", scope: "all", reason: null, startsAt: null, endsAt: null }, "admin1"))
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
    expect((h.db as unknown as Record<string, ReturnType<typeof vi.fn>>).$executeRaw).toHaveBeenCalled();
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
  it("만료된 미검증 PENDING이 있으면 동일 행을 교체(updateMany — conditional CAS) + 메일 재enqueue — D10·D16(멱등 재시도) [NF1]", async () => {
    h.db.user.count.mockResolvedValue(0);
    h.db.user.findUnique.mockResolvedValue({ id: "u-old", status: "PENDING", emailVerifiedAt: null, emailVerifyExpiresAt: new Date("2026-05-01T00:00:00Z") });
    // NF1: 교체 경로는 id-only update가 아니라 replaceability 조건을 where에 담은 updateMany를 사용한다.
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    h.db.mailDelivery.create.mockResolvedValue({ id: "md1" });
    const res = await createPendingSignup(args);
    expect(res).toEqual({ id: "u-old" });
    // updateMany의 where에 replaceability 조건(id + status:PENDING + emailVerifiedAt:null + emailVerifyExpiresAt:{lt:now}) 포함 확인
    expect(h.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "u-old",
        status: "PENDING",
        emailVerifiedAt: null,
        emailVerifyExpiresAt: { lt: expect.any(Date) },
      }),
      data: expect.objectContaining({ emailVerifyTokenHash: "th", status: "PENDING" }),
    }));
    expect(h.db.user.update).not.toHaveBeenCalled();
    expect(h.db.user.create).not.toHaveBeenCalled();
    // 교체 경로도 토큰·메일 재발급(같은 트랜잭션)
    expect(h.db.mailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaveRequestId: null, eventType: "VERIFY_EMAIL" }),
    }));
  });
  it("NF1: 교체 시 updateMany count 0(동시 거절/교체로 행 변경) → UserConflictError, mail 미enqueue", async () => {
    h.db.user.count.mockResolvedValue(0);
    h.db.user.findUnique.mockResolvedValue({ id: "u-old", status: "PENDING", emailVerifiedAt: null, emailVerifyExpiresAt: new Date("2026-05-01T00:00:00Z") });
    // 동시 rejectTx가 먼저 커밋해 row가 REJECTED로 바뀐 상황 → updateMany count=0
    h.db.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(createPendingSignup(args)).rejects.toBeInstanceOf(UserConflictError);
    expect(h.db.mailDelivery.create).not.toHaveBeenCalled();
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
    expect((h.db as unknown as Record<string, ReturnType<typeof vi.fn>>).$executeRaw).toHaveBeenCalled();
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
    // F3 regression: where에 status:"PENDING" + emailVerifiedAt:null 포함 확인
    expect(h.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { emailVerifyTokenHash: "th", emailVerifyExpiresAt: { gt: now }, status: "PENDING", emailVerifiedAt: null },
      data: { passwordHash: "newhash", emailVerifiedAt: now, emailVerifyTokenHash: null, emailVerifyExpiresAt: null },
    }));
  });
  it("토큰 미일치/만료(count 0)면 null 반환", async () => {
    h.db.user.updateMany.mockResolvedValue({ count: 0 });
    expect(await setPasswordViaToken("bad", "h", new Date())).toBeNull();
  });
  // F3 regression: 이미 검증됐거나(emailVerifiedAt not null) PENDING이 아닌 사용자는 토큰 소비 불가
  it("F3: updateMany where에 status:PENDING·emailVerifiedAt:null 조건 포함 — 이미 처리된 사용자 토큰 소비 차단", async () => {
    const now = new Date("2026-06-10T00:00:00Z");
    // count=0 시뮬레이션: REJECTED/이미검증 사용자는 status:PENDING+emailVerifiedAt:null 조건으로 걸러짐
    h.db.user.updateMany.mockResolvedValue({ count: 0 });
    const res = await setPasswordViaToken("th", "newhash", now);
    expect(res).toBeNull();
    // where에 status·emailVerifiedAt 조건이 존재하는지 검증
    const whereArg = h.db.user.updateMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(whereArg).toMatchObject({ status: "PENDING", emailVerifiedAt: null });
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
    h.db.user.findUnique.mockResolvedValue({ status: "REJECTED", updatedAt: new Date("2026-06-01T00:00:00Z"), emailVerifiedAt: new Date("2026-05-01T00:00:00Z"), systemRole: "MEMBER", roleAssignments: [] });
    h.db.user.updateMany.mockResolvedValue({ count: 1 });
    await reactivateRejectedTx("u1", "admin1", new Date());
    expect(h.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", status: "REJECTED" }, data: expect.objectContaining({ status: "ACTIVE" }),
    }));
  });
  it("REJECTED 아니면 UserConflictError", async () => {
    h.db.user.findUnique.mockResolvedValue({ status: "ACTIVE", updatedAt: new Date(), emailVerifiedAt: new Date(), systemRole: "MEMBER", roleAssignments: [] });
    await expect(reactivateRejectedTx("u1", "admin1", new Date())).rejects.toBeInstanceOf(UserConflictError);
  });
  it("Finding C: emailVerifiedAt=null(미검증 거절)이면 재활성 거부 — UserConflictError, updateMany 미호출", async () => {
    // 자가 가입 후 비번 미설정 상태에서 거절된 계정 — rejectTx가 verify 토큰을 소거했으므로
    // ACTIVE로 만들면 로그인도 불가하고 검증 토큰도 없는 wedged 계정이 된다(Finding C).
    h.db.user.findUnique.mockResolvedValue({ status: "REJECTED", updatedAt: new Date("2026-06-01T00:00:00Z"), emailVerifiedAt: null, systemRole: "MEMBER", roleAssignments: [] });
    await expect(reactivateRejectedTx("u1", "admin1", new Date())).rejects.toBeInstanceOf(UserConflictError);
    expect(h.db.user.updateMany).not.toHaveBeenCalled();
  });
});
