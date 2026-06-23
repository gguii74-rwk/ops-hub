import { describe, expect, it, vi, beforeEach } from "vitest";

// getEffectiveScope는 guards.ts에서 import해 사용 — 테스트에서 모킹.
const mockGetEffectiveScope = vi.fn();
vi.mock("@/kernel/access", () => ({
  getEffectiveScope: (...args: unknown[]) => mockGetEffectiveScope(...args),
  SCOPE_RANK: { all: 3, team: 2, own: 1 },
}));
// F-EE: team-team ALLOW 분기가 prisma.user.findUnique(actor/target teamId)를 사용 → mock.
const mockUserFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) } },
}));

import {
  assertNotSelfMutation,
  assertCanAssignRoles,
  assertCanSetSystemRole,
  assertOverrideWithinActorGrant,
  countAvailableByPermission,
  assertMinAvailability,
  type ActorContext,
} from "@/modules/admin/users/services/guards";
import { EscalationError, MinAvailabilityError } from "@/modules/admin/users/errors";
import type { PrismaTx } from "@/lib/prisma";

beforeEach(() => {
  vi.clearAllMocks();
  // 기본: non-critical 권한에 대해 actor가 "all" scope 보유 → ALLOW 허용.
  mockGetEffectiveScope.mockResolvedValue("all");
  // 기본: actor·target 같은 팀(team-team 분기 기본 통과). cross-team 테스트는 per-test 재설정.
  mockUserFindUnique.mockResolvedValue({ teamId: "teamA" });
});

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

describe("assertOverrideWithinActorGrant (D13ⓒⓓ·F-N·F-EE — critical OWNER-only·scope-aware ALLOW·교차팀 차단)", () => {
  const T = "target1"; // 대상 사용자(기본 actor와 같은 팀 teamA)
  it("ALLOW: 비-critical actor scope=all 보유 권한이면 허용", async () => {
    mockGetEffectiveScope.mockResolvedValue("all");
    await expect(assertOverrideWithinActorGrant(delegate(["leave.approval:approve"]), T, "leave.approval", "approve", "ALLOW", "all")).resolves.toBeUndefined();
  });
  it("ALLOW: 비-critical actor 미보유(getEffectiveScope=null)이면 EscalationError(가진 것 이상 못 줌)", async () => {
    mockGetEffectiveScope.mockResolvedValue(null);
    await expect(assertOverrideWithinActorGrant(delegate([]), T, "leave.approval", "approve", "ALLOW", "all")).rejects.toBeInstanceOf(EscalationError);
  });
  it("DENY: 비-critical 권한은 위임 admin 허용(getEffectiveScope 호출 안 함)", async () => {
    await expect(assertOverrideWithinActorGrant(delegate([]), T, "leave.approval", "approve", "DENY", "all")).resolves.toBeUndefined();
    expect(mockGetEffectiveScope).not.toHaveBeenCalled();
  });
  it("ALLOW: critical(admin.users:update)은 actor가 보유하고 있어도 비-OWNER 거부(finding D)", async () => {
    await expect(assertOverrideWithinActorGrant(delegate(["admin.users:update"]), T, "admin.users", "update", "ALLOW", "all")).rejects.toBeInstanceOf(EscalationError);
  });
  it("ALLOW: critical(admin.audit:view)은 actor가 보유하고 있어도 비-OWNER 거부(finding D)", async () => {
    await expect(assertOverrideWithinActorGrant(delegate(["admin.audit:view"]), T, "admin.audit", "view", "ALLOW", "all")).rejects.toBeInstanceOf(EscalationError);
  });
  it("DENY: critical(admin.*) 권한은 비-OWNER 거부(lockout 방지)", async () => {
    await expect(assertOverrideWithinActorGrant(delegate(["admin.users:update"]), T, "admin.users", "update", "DENY", "all")).rejects.toBeInstanceOf(EscalationError);
  });
  it("OWNER는 critical ALLOW·critical DENY·비-critical 미보유 ALLOW 모두 허용", async () => {
    await expect(assertOverrideWithinActorGrant(owner(), T, "admin.users", "update", "ALLOW", "all")).resolves.toBeUndefined();
    await expect(assertOverrideWithinActorGrant(owner(), T, "admin.users", "update", "DENY", "all")).resolves.toBeUndefined();
    await expect(assertOverrideWithinActorGrant(owner(), T, "admin.audit", "view", "ALLOW", "all")).resolves.toBeUndefined();
    await expect(assertOverrideWithinActorGrant(owner(), T, "leave.approval", "approve", "ALLOW", "all")).resolves.toBeUndefined();
  });
  it("F-N: team-scope actor가 all-scope ALLOW 부여 시도 → EscalationError(scope 초과)", async () => {
    mockGetEffectiveScope.mockResolvedValue("team"); // actor scope=team
    await expect(assertOverrideWithinActorGrant(delegate([]), T, "leave.approval", "approve", "ALLOW", "all")).rejects.toBeInstanceOf(EscalationError);
  });
  it("F-EE: team-scope actor가 같은 팀 사용자에게 team-scope ALLOW 부여 → 허용", async () => {
    mockGetEffectiveScope.mockResolvedValue("team");
    mockUserFindUnique.mockResolvedValue({ teamId: "teamA" }); // actor·target 동일 팀
    await expect(assertOverrideWithinActorGrant(delegate([]), T, "leave.approval", "approve", "ALLOW", "team")).resolves.toBeUndefined();
  });
  it("F-EE: team-scope actor가 다른 팀 사용자에게 team-scope ALLOW 부여 → EscalationError(교차 팀 위임 금지)", async () => {
    mockGetEffectiveScope.mockResolvedValue("team");
    mockUserFindUnique
      .mockResolvedValueOnce({ teamId: "teamA" })  // actor
      .mockResolvedValueOnce({ teamId: "teamB" }); // target — 다른 팀
    await expect(assertOverrideWithinActorGrant(delegate([]), T, "leave.approval", "approve", "ALLOW", "team")).rejects.toBeInstanceOf(EscalationError);
  });
  it("F-EE: team-scope actor가 팀 미소속이면 team-scope ALLOW 부여 불가(teamId null)", async () => {
    mockGetEffectiveScope.mockResolvedValue("team");
    mockUserFindUnique.mockResolvedValue({ teamId: null }); // actor·target 모두 null → 같은 팀 아님(null)
    await expect(assertOverrideWithinActorGrant(delegate([]), T, "leave.approval", "approve", "ALLOW", "team")).rejects.toBeInstanceOf(EscalationError);
  });
  it("F-EE: all-scope actor는 어느 팀 사용자에게든 team-scope ALLOW 부여 가능(교차팀 검사 건너뜀)", async () => {
    mockGetEffectiveScope.mockResolvedValue("all"); // actor scope=all → 전 팀 커버
    mockUserFindUnique.mockResolvedValue({ teamId: "teamZ" });
    await expect(assertOverrideWithinActorGrant(delegate([]), T, "leave.approval", "approve", "ALLOW", "team")).resolves.toBeUndefined();
    expect(mockUserFindUnique).not.toHaveBeenCalled(); // all-scope면 팀 조회 자체를 안 함
  });
  it("F-N: assigned scope는 항상 EscalationError(미해석 scope)", async () => {
    mockGetEffectiveScope.mockResolvedValue("all");
    await expect(assertOverrideWithinActorGrant(delegate([]), T, "leave.approval", "approve", "ALLOW", "assigned")).rejects.toBeInstanceOf(EscalationError);
  });
});

// permission.findUnique → user.count(OWNER 보존) → user.findMany → rolePermission.findMany 를 모킹한 fake tx.
// owners: assertMinAvailability의 ACTIVE OWNER 카운트(finding 1). 기본 1(기존 테스트 호환), 0이면 OWNER 보존 위반.
function fakeTx(opts: {
  permissionId: string | null;
  owners?: number;
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
      count: vi.fn(async () => opts.owners ?? 1), // ACTIVE OWNER 카운트(finding 1)
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

describe("assertMinAvailability (D13ⓔ·D12 OWNER 보존)", () => {
  it("user-management 가용 0 → MinAvailabilityError", async () => {
    const tx = fakeTx({ permissionId: "p1", users: [] }); // OWNER 1(기본)이나 권한 보유자 0
    await expect(assertMinAvailability(tx)).rejects.toThrow(MinAvailabilityError);
  });
  it("user-management·audit 모두 ≥1 → 통과(OWNER 한 명이 둘 다 충족)", async () => {
    const tx = fakeTx({ permissionId: null, users: [{ systemRole: "OWNER" }] });
    await expect(assertMinAvailability(tx)).resolves.toBeUndefined();
  });
  it("finding 1: ACTIVE OWNER 0명이면 MinAvailabilityError(권한 카운트 충족과 무관)", async () => {
    // owners=0이지만 user-management·audit는 충족(권한 보유 MEMBER) → 그래도 OWNER 보존 위반으로 거부.
    const tx = fakeTx({
      permissionId: "p1",
      owners: 0,
      users: [{ systemRole: "MEMBER", roleAssignments: [{ roleId: "r1", startsAt: null, endsAt: null }] }],
      rolePerms: [{ roleId: "r1", effect: "ALLOW", scope: "all" }],
    });
    await expect(assertMinAvailability(tx)).rejects.toThrow(MinAvailabilityError);
    // 통합리뷰 finding: OWNER 보존 count는 "사용 가능한" OWNER만 세야 한다 — mustChangePassword=true OWNER는
    // 권한 엔진이 fail-closed로 전부 거부(task-07)해 OWNER 권능을 못 쓰므로 where에 mustChangePassword:false가 포함돼야 한다.
    expect((tx.user.count as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { systemRole: "OWNER", status: "ACTIVE", mustChangePassword: false } }),
    );
  });
});
