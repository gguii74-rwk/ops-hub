import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    permission: { findUnique: vi.fn() },
    userPermissionOverride: { findMany: vi.fn() },
    rolePermission: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { getEffectiveScope, requirePermissionForTarget, ForbiddenError } from "@/kernel/access";

// user.findUnique는 loadUserContext(systemRole/status/mustChangePassword/roleAssignments)와 teamId 조회를 겸한다 → 합본 반환.
function mockUser(over: Record<string, unknown> = {}) {
  h.db.user.findUnique.mockResolvedValue({
    systemRole: "MEMBER", status: "ACTIVE", mustChangePassword: false,
    roleAssignments: [{ roleId: "r1", startsAt: null, endsAt: null }],
    teamId: "teamA", ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.db.permission.findUnique.mockResolvedValue({ id: "p1" });
  h.db.userPermissionOverride.findMany.mockResolvedValue([]);
  h.db.rolePermission.findMany.mockResolvedValue([]);
});

describe("getEffectiveScope", () => {
  it("OWNER → all", async () => {
    mockUser({ systemRole: "OWNER", roleAssignments: [] });
    expect(await getEffectiveScope("u1", "leave.approval", "view")).toBe("all");
  });
  it("role ALLOW team → team", async () => {
    mockUser();
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "team" }]);
    expect(await getEffectiveScope("u1", "leave.approval", "view")).toBe("team");
  });
  it("권한 미존재 → null", async () => {
    mockUser();
    h.db.permission.findUnique.mockResolvedValue(null);
    expect(await getEffectiveScope("u1", "leave.approval", "view")).toBeNull();
  });
  it("must-change → null", async () => {
    mockUser({ mustChangePassword: true });
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "all" }]);
    expect(await getEffectiveScope("u1", "leave.approval", "view")).toBeNull();
  });
  // F-A — 비-scopeable resource(admin.teams)에 team grant가 있어도 clamp되어 null.
  it("비-scopeable resource + team grant → null(allowedScopes clamp, F-A)", async () => {
    mockUser();
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "team" }]);
    expect(await getEffectiveScope("u1", "admin.teams", "view")).toBeNull();
  });
  it("비-scopeable resource + all grant → all(정상)", async () => {
    mockUser();
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "all" }]);
    expect(await getEffectiveScope("u1", "admin.teams", "view")).toBe("all");
  });
});

describe("requirePermissionForTarget", () => {
  it("team scope + 같은 팀 target → 허용", async () => {
    mockUser({ teamId: "teamA" });
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "team" }]);
    await expect(requirePermissionForTarget("u1", "leave.approval", "approve", { teamId: "teamA" })).resolves.toBeUndefined();
  });
  it("team scope + 타 팀 target → 거부(F3/보안)", async () => {
    mockUser({ teamId: "teamA" });
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "team" }]);
    await expect(requirePermissionForTarget("u1", "leave.approval", "approve", { teamId: "teamB" })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("team scope + 무소속 actor(teamId null) → 거부(F9)", async () => {
    mockUser({ teamId: null });
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "team" }]);
    await expect(requirePermissionForTarget("u1", "leave.approval", "approve", { teamId: "teamA" })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("all scope → target 무관 허용", async () => {
    mockUser();
    h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "all" }]);
    await expect(requirePermissionForTarget("u1", "leave.approval", "approve", { teamId: null })).resolves.toBeUndefined();
  });
  it("미허가(null scope) → 거부", async () => {
    mockUser();
    await expect(requirePermissionForTarget("u1", "leave.approval", "approve", { teamId: "teamA" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
