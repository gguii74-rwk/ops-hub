import { describe, it, expect, vi, beforeEach } from "vitest";

// repository는 모킹(가드를 통과한 경우에만 호출되어야 함). 가드/policy/errors는 실제 모듈.
// Drift 1: @/lib/auth/password 모듈은 존재하지 않는다. 서비스는 bcryptjs를 직접 사용하므로 그쪽을 모킹한다.
// 가드 거부(EscalationError) 시나리오는 bcrypt가 호출되기 전에 throw하므로 대부분 bcrypt mock 불필요.
// createUserByAdmin은 bcrypt.hash를 호출하므로 해당 모킹만 추가.
// F-Q: upsertOverride/removeOverride가 prisma.$transaction으로 감싸져 실 DB 불필요 → prisma mock 추가.
// assertOverrideWithinActorGrant가 getEffectiveScope(DB 호출)를 사용 → @/kernel/access mock 추가.
const mockGetEffectiveScope = vi.fn(async (_userId: string, _resource: string, _action: string, _tx?: unknown): Promise<string | null> => "all");
const h = vi.hoisted(() => ({
  repo: {
    approveTx: vi.fn(async () => undefined),
    rejectTx: vi.fn(async () => undefined),
    createActiveUserByAdminTx: vi.fn(async () => ({ id: "u-new" })),
    setRoles: vi.fn(async () => undefined),
    createOverride: vi.fn(async () => ({ id: "ov1" })),
    deleteOverride: vi.fn(async () => undefined),
    resetPasswordTx: vi.fn(async () => undefined),
    updateUserTx: vi.fn(async () => undefined),
    getUserDetail: vi.fn(async () => userDetailFixture()),
  },
}));

// 대상 UserDetail 픽스처 — systemRole/status를 string 타입으로 선언해 mockResolvedValue에서 다른 역할값도 허용.
function userDetailFixture(over: Record<string, unknown> = {}) {
  return {
    id: "target1", systemRole: "MEMBER", roleKeys: [] as string[],
    updatedAt: new Date(), emailVerifiedAt: new Date(),
    email: "target@x.com", name: "대상", status: "ACTIVE",
    teamId: null, teamName: null, employmentType: "REGULAR", jobFunction: "DEVELOPER",
    mustChangePassword: false, createdAt: new Date(), overrides: [] as never[],
    ...over,
  };
}

vi.mock("@/modules/admin/users/repositories", () => h.repo);
vi.mock("@/modules/leave/services/mail", () => ({ triggerLeaveMailDrain: vi.fn() }));
// bcryptjs: createUserByAdmin이 임시비번을 해시한다. 거부 시나리오는 bcrypt 전에 throw하므로 mock 불필요하나,
// 허용 시나리오(OWNER 대조군)에서 실제 bcrypt가 돌면 느리므로 고정값 반환.
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "HASHED"), compare: vi.fn(async () => true) } }));
// F-Q: upsertOverride/removeOverride는 prisma.$transaction으로 감쌈 — DB 없이 동작하도록 passthrough mock.
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: vi.fn() })) },
}));
// assertOverrideWithinActorGrant가 getEffectiveScope(DB 조회)를 사용 — "all"을 기본으로 반환(mock).
vi.mock("@/kernel/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/kernel/access")>();
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getEffectiveScope: (userId: any, resource: any, action: any, tx?: any) =>
      mockGetEffectiveScope(userId, resource, action, tx),
  };
});

import {
  approveUser, createUserByAdmin, assignRoles, upsertOverride, resetPassword, updateUser,
} from "@/modules/admin/users/services";
import { EscalationError, MinAvailabilityError } from "@/modules/admin/users/errors";
import type { ActorContext } from "@/modules/admin/users/services/guards";

const owner: ActorContext = {
  userId: "owner1", isOwner: true,
  permissionKeys: new Set(["admin.users:update", "admin.users:approve", "admin.users:create"]),
};
// 위임 admin: admin.users:* 보유하나 비-OWNER. leave.approval:approve는 미보유(ⓒ 검증용).
const delegate: ActorContext = {
  userId: "admin1", isOwner: false,
  permissionKeys: new Set([
    "admin.users:view", "admin.users:create", "admin.users:update",
    "admin.users:approve", "admin.audit:view",
  ]),
};

// 낙관락: 라우트가 클라가 본 행 버전을 service에 넘긴다(이 통합 테스트는 가드 동작만 보므로 임의 고정값).
const EXP = new Date("2026-06-01T00:00:00.000Z");

// 유효한 AdminCreateInput(password 포함).
const adminInput = (extra: Record<string, unknown> = {}) => ({
  email: "x@x.com", name: "n", password: "ValidPassword12!",
  employmentType: "REGULAR" as const, jobFunction: "DEVELOPER" as const,
  teamId: null, systemRole: "MEMBER" as const, roleKeys: [] as string[],
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  // getEffectiveScope: 기본값 "all"(actor가 해당 권한을 보유). 미보유 케이스는 각 테스트에서 mockResolvedValueOnce(null).
  mockGetEffectiveScope.mockResolvedValue("all");
  h.repo.getUserDetail.mockResolvedValue(userDetailFixture() as never);
});

// ⓐ 자가 mutation 금지 — 본인 역할/override/systemRole/status
describe("D13ⓐ 위임 admin 자가 mutation 거부", () => {
  it("자기 자신 역할 부여 → EscalationError, setRoles 미호출", async () => {
    await expect(assignRoles(delegate, delegate.userId, ["regular-developer"], EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.setRoles).not.toHaveBeenCalled();
  });
  it("자기 자신 override 부여 → EscalationError, createOverride 미호출", async () => {
    await expect(upsertOverride(delegate, delegate.userId, {
      resource: "admin.users", action: "view", effect: "ALLOW", scope: "all", reason: null, startsAt: null, endsAt: null,
    })).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.createOverride).not.toHaveBeenCalled();
  });
  it("자기 자신 systemRole 변경 → EscalationError, updateUserTx 미호출", async () => {
    await expect(updateUser(delegate, delegate.userId, { systemRole: "ADMIN" }, EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.updateUserTx).not.toHaveBeenCalled();
  });
  it("OWNER는 자기 자신도 허용(대조군)", async () => {
    await expect(assignRoles(owner, owner.userId, ["pm"], EXP)).resolves.not.toThrow();
    expect(h.repo.setRoles).toHaveBeenCalled();
  });
});

// ⓑ 특권 역할(pm·admin) 부여는 OWNER만 — roles·:create·:approve 경로 전부
describe("D13ⓑ 특권 역할 부여는 OWNER만 (roles·create·approve 경로 전부)", () => {
  it("roles 경로: 위임 admin이 pm 부여 → EscalationError, setRoles 미호출", async () => {
    await expect(assignRoles(delegate, "target1", ["pm"], EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.setRoles).not.toHaveBeenCalled();
  });
  it(":create 경로: 위임 admin이 admin 역할로 직접추가 → EscalationError, createActiveUserByAdminTx 미호출", async () => {
    await expect(createUserByAdmin(delegate, adminInput({ roleKeys: ["admin"] }))).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.createActiveUserByAdminTx).not.toHaveBeenCalled();
  });
  it(":approve 경로: 위임 admin이 승인 시 pm 확정 → EscalationError, approveTx 미호출", async () => {
    await expect(approveUser(delegate, "target1", {
      employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: ["pm"],
    }, EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.approveTx).not.toHaveBeenCalled();
  });
  it("roles 경로(제거): 위임 admin이 대상의 기존 pm을 목록에서 빼서 제출 → EscalationError(finding C — lockout 방지)", async () => {
    // 대상 현재 roleKeys=[pm] → next=[]: pm 제거 = 특권 회수. 추가가 아니어도 OWNER-only.
    h.repo.getUserDetail.mockResolvedValue(userDetailFixture({ roleKeys: ["pm"] }) as never);
    await expect(assignRoles(delegate, "target1", [], EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.setRoles).not.toHaveBeenCalled();
  });
  it("roles 경로(제거): 위임 admin이 대상의 기존 admin 역할을 빼서 제출 → EscalationError", async () => {
    h.repo.getUserDetail.mockResolvedValue(userDetailFixture({ roleKeys: ["admin", "regular-developer"] }) as never);
    await expect(assignRoles(delegate, "target1", ["regular-developer"], EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.setRoles).not.toHaveBeenCalled();
  });
  it("roles 경로: 위임 admin이 기존 pm을 유지한 채 비특권만 교체 → 허용(특권 차집합 비어 있음)", async () => {
    h.repo.getUserDetail.mockResolvedValue(userDetailFixture({ roleKeys: ["pm", "regular-developer"] }) as never);
    await expect(assignRoles(delegate, "target1", ["pm", "contractor-content"], EXP)).resolves.not.toThrow();
    expect(h.repo.setRoles).toHaveBeenCalled();
  });
  it("OWNER는 세 경로 모두에서 pm/admin 부여 허용", async () => {
    await expect(assignRoles(owner, "target1", ["pm"], EXP)).resolves.not.toThrow();
    vi.clearAllMocks();
    h.repo.getUserDetail.mockResolvedValue(userDetailFixture({ email: "y@x.com", name: "n" }) as never);
    await expect(createUserByAdmin(owner, adminInput({ systemRole: "ADMIN", roleKeys: ["admin"] }))).resolves.not.toThrow();
    await expect(approveUser(owner, "target1", {
      employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: ["pm"],
    }, EXP)).resolves.not.toThrow();
  });
});

// systemRole 상승(OWNER/ADMIN)도 OWNER만 — create·approve·update 경로
describe("D12 OWNER/ADMIN systemRole 부여는 OWNER만 (create·approve·update)", () => {
  it("위임 admin이 :create로 ADMIN systemRole → EscalationError", async () => {
    await expect(createUserByAdmin(delegate, adminInput({ systemRole: "ADMIN" }))).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 :approve로 OWNER systemRole 확정 → EscalationError", async () => {
    await expect(approveUser(delegate, "target1", {
      employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "OWNER", roleKeys: [],
    }, EXP)).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 update로 ADMIN 승격 → EscalationError, updateUserTx 미호출", async () => {
    await expect(updateUser(delegate, "target1", { systemRole: "ADMIN" }, EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.updateUserTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 update로 기존 OWNER 대상을 MEMBER로 강등 → EscalationError(finding C — 현재가 특권이면 OWNER-only)", async () => {
    h.repo.getUserDetail.mockResolvedValue(userDetailFixture({ systemRole: "OWNER" }) as never);
    await expect(updateUser(delegate, "target1", { systemRole: "MEMBER" }, EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.updateUserTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 기존 ADMIN 대상을 systemRole 미지정으로 편집 → EscalationError(현재 특권 보호)", async () => {
    h.repo.getUserDetail.mockResolvedValue(userDetailFixture({ systemRole: "ADMIN" }) as never);
    await expect(updateUser(delegate, "target1", { name: "수정" }, EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.updateUserTx).not.toHaveBeenCalled();
  });
});

// ⓒ 미보유 권한 ALLOW override 거부
describe("D13ⓒ 미보유 권한 ALLOW override 거부 (가진 것 이상 못 줌)", () => {
  it("위임 admin이 미보유 leave.approval:approve ALLOW → EscalationError, createOverride 미호출", async () => {
    // actor가 해당 권한을 미보유 → getEffectiveScope null 반환 → EscalationError.
    mockGetEffectiveScope.mockResolvedValueOnce(null);
    await expect(upsertOverride(delegate, "target1", {
      resource: "leave.approval", action: "approve", effect: "ALLOW", scope: "all", reason: null, startsAt: null, endsAt: null,
    })).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.createOverride).not.toHaveBeenCalled();
  });
  it("위임 admin이 보유한 admin.users:view ALLOW → EscalationError(admin.* = critical, OWNER-only)", async () => {
    // admin.* prefix는 CRITICAL_RESOURCE_PREFIXES에 속해 OWNER-only(ⓓ). 위임 admin이 보유하더라도 ALLOW 불가.
    await expect(upsertOverride(delegate, "target1", {
      resource: "admin.users", action: "view", effect: "ALLOW", scope: "all", reason: null, startsAt: null, endsAt: null,
    })).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 보유한 비-critical 권한 ALLOW → 허용", async () => {
    // leave.request:view 가 delegate의 permissionKeys에 있다고 가정하는 대신,
    // 실제 가드 로직 검증: critical이 아니고 actor가 보유한 권한의 ALLOW override는 통과.
    const delegateWithLeave: ActorContext = {
      userId: "admin1", isOwner: false,
      permissionKeys: new Set(["leave.request:view"]),
    };
    await expect(upsertOverride(delegateWithLeave, "target1", {
      resource: "leave.request", action: "view", effect: "ALLOW", scope: "all", reason: null, startsAt: null, endsAt: null,
    })).resolves.not.toThrow();
    expect(h.repo.createOverride).toHaveBeenCalled();
  });
});

// ⓓ 동료 admin.*·audit DENY override 거부(lockout 방지)
describe("D13ⓓ critical(admin.*) DENY override는 OWNER만", () => {
  it("위임 admin이 동료 대상 admin.users:update DENY → EscalationError", async () => {
    await expect(upsertOverride(delegate, "target1", {
      resource: "admin.users", action: "update", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null,
    })).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 동료 대상 admin.audit:view DENY → EscalationError", async () => {
    await expect(upsertOverride(delegate, "target1", {
      resource: "admin.audit", action: "view", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null,
    })).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 비-critical leave.approval:approve DENY → 허용", async () => {
    await expect(upsertOverride(delegate, "target1", {
      resource: "leave.approval", action: "approve", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null,
    })).resolves.not.toThrow();
  });
  it("OWNER는 critical DENY 허용", async () => {
    await expect(upsertOverride(owner, "target1", {
      resource: "admin.users", action: "update", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null,
    })).resolves.not.toThrow();
  });
});

// ⓔ/ⓕ 최소 가용성 — reset-password 포함. repository가 throw하는 MinAvailabilityError를 서비스가 전파.
describe("D13ⓔ/ⓕ 최소 가용성 보존 (mutation이 마지막 관리자/감사조회자를 0으로 만들면 거부)", () => {
  it("setRoles가 MinAvailabilityError를 던지면 서비스가 전파(role 제거 경로)", async () => {
    h.repo.setRoles.mockRejectedValueOnce(new MinAvailabilityError("last admin"));
    await expect(assignRoles(delegate, "target1", [], EXP)).rejects.toBeInstanceOf(MinAvailabilityError);
  });
  it("reset-password가 MinAvailabilityError를 던지면 전파(D14 — reset도 가용성 포함)", async () => {
    h.repo.resetPasswordTx.mockRejectedValueOnce(new MinAvailabilityError("last admin via must-change"));
    await expect(resetPassword(owner, "target1")).rejects.toBeInstanceOf(MinAvailabilityError);
  });
  it("finding 1: 마지막 OWNER 강등 시 MinAvailabilityError 전파 — OWNER 행위자도 막힘(권한 아닌 가용성 불변식)", async () => {
    // 대상이 OWNER. OWNER 행위자는 assertCanSetSystemRole을 통과하지만,
    // repo의 updateUserTx가 assertMinAvailability(ACTIVE OWNER < 1) 위반으로 throw → 서비스가 전파.
    h.repo.getUserDetail.mockResolvedValue(userDetailFixture({ systemRole: "OWNER" }) as never);
    h.repo.updateUserTx.mockRejectedValueOnce(new MinAvailabilityError("최소 1명의 활성 OWNER가 남아야 합니다."));
    await expect(updateUser(owner, "target1", { systemRole: "MEMBER" }, EXP)).rejects.toBeInstanceOf(MinAvailabilityError);
  });
});

// D14 — 특권 대상 reset-password는 OWNER만(위임 admin 거부)
describe("D14 특권 대상 reset-password는 OWNER만", () => {
  it("위임 admin이 OWNER systemRole 대상 reset → EscalationError, resetPasswordTx 미호출", async () => {
    h.repo.getUserDetail.mockResolvedValue(userDetailFixture({ systemRole: "OWNER" }) as never);
    await expect(resetPassword(delegate, "target1")).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.resetPasswordTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 pm 역할 보유 대상 reset → EscalationError", async () => {
    h.repo.getUserDetail.mockResolvedValue(userDetailFixture({ roleKeys: ["pm"] }) as never);
    await expect(resetPassword(delegate, "target1")).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 비특권 대상 reset → 허용, resetPasswordTx 호출됨", async () => {
    h.repo.getUserDetail.mockResolvedValue(userDetailFixture({ roleKeys: ["regular-developer"] }) as never);
    await expect(resetPassword(delegate, "target1")).resolves.not.toThrow();
    expect(h.repo.resetPasswordTx).toHaveBeenCalled();
  });
  it("위임 admin이 자기 자신 reset(admin 라우트) → EscalationError(D14·ⓐ — self-reset 절대 차단)", async () => {
    await expect(resetPassword(delegate, delegate.userId)).rejects.toBeInstanceOf(EscalationError);
  });
});
