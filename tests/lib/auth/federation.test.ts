import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueClaims, toGroups } from "@/lib/auth/federation/claims";
import type { SessionUser } from "@/lib/auth/types";

const { mockAuth, mockFindUnique } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindUnique: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mockFindUnique } } }));

const base: SessionUser = {
  id: "u1",
  email: "a@b.com",
  name: "A",
  systemRole: "MEMBER",
  employmentType: "REGULAR",
  jobFunction: "DEVELOPER",
  mustChangePassword: false,
};

describe("federation claims", () => {
  it("every authenticated user gets kgs-user", () => {
    expect(toGroups(base)).toEqual(["kgs-user"]);
  });

  it("OWNER/ADMIN gets ops-admin", () => {
    expect(toGroups({ ...base, systemRole: "OWNER" })).toContain("ops-admin");
    expect(toGroups({ ...base, systemRole: "ADMIN" })).toContain("ops-admin");
  });

  it("MANAGER gets ops-manager", () => {
    expect(toGroups({ ...base, systemRole: "MANAGER" })).toContain("ops-manager");
  });

  it("issueClaims exposes only sub/email/groups", () => {
    expect(issueClaims(base)).toEqual({ sub: "u1", email: "a@b.com", groups: ["kgs-user"] });
  });
});

describe("verifySession (fail-closed against live DB, not the JWT snapshot)", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockFindUnique.mockReset();
  });

  it("returns null when there is no session, without touching the DB", async () => {
    const { verifySession } = await import("@/lib/auth/federation");
    mockAuth.mockResolvedValue(null);
    expect(await verifySession()).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when the session user no longer exists in the DB", async () => {
    const { verifySession } = await import("@/lib/auth/federation");
    mockAuth.mockResolvedValue({ user: { id: "u1" } });
    mockFindUnique.mockResolvedValue(null);
    expect(await verifySession()).toBeNull();
  });

  it("returns null for a disabled user even when the session is still valid", async () => {
    const { verifySession } = await import("@/lib/auth/federation");
    mockAuth.mockResolvedValue({ user: { id: "u1", systemRole: "ADMIN" } });
    mockFindUnique.mockResolvedValue({ id: "u1", email: "a@b.com", systemRole: "ADMIN", status: "DISABLED", mustChangePassword: false, passwordChangedAt: null, sessionInvalidatedAt: null });
    expect(await verifySession()).toBeNull();
  });

  it("builds claims from current DB role, not the stale JWT (post-login demotion drops ops-admin)", async () => {
    const { verifySession } = await import("@/lib/auth/federation");
    // JWT snapshot still says ADMIN with a stale email; DB is the source of truth.
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "stale@b.com", systemRole: "ADMIN" } });
    mockFindUnique.mockResolvedValue({ id: "u1", email: "a@b.com", systemRole: "MEMBER", status: "ACTIVE", mustChangePassword: false, passwordChangedAt: null, sessionInvalidatedAt: null });
    expect(await verifySession()).toEqual({ sub: "u1", email: "a@b.com", groups: ["kgs-user"] });
  });

  it("grants ops-admin for an active OWNER from the DB", async () => {
    const { verifySession } = await import("@/lib/auth/federation");
    mockAuth.mockResolvedValue({ user: { id: "u1" } });
    mockFindUnique.mockResolvedValue({ id: "u1", email: "owner@b.com", systemRole: "OWNER", status: "ACTIVE", mustChangePassword: false, passwordChangedAt: null, sessionInvalidatedAt: null });
    expect(await verifySession()).toEqual({ sub: "u1", email: "owner@b.com", groups: ["kgs-user", "ops-admin"] });
  });

  it("must-change 사용자는 null(federation 헤더/그룹 미발급)", async () => {
    const { verifySession } = await import("@/lib/auth/federation");
    mockAuth.mockResolvedValue({ user: { id: "u1" } });
    mockFindUnique.mockResolvedValue({
      id: "u1", email: "a@b.com", systemRole: "MEMBER", status: "ACTIVE",
      mustChangePassword: true, passwordChangedAt: null, sessionInvalidatedAt: null,
    });
    expect(await verifySession()).toBeNull();
  });

  it("passwordChangedAt이 세션 발급 이후면 null(비번변경 세션무효)", async () => {
    const { verifySession } = await import("@/lib/auth/federation");
    // auth() 세션의 발급시각(iat)보다 DB passwordChangedAt이 뒤 → 무효.
    mockAuth.mockResolvedValue({ user: { id: "u1" } });
    mockFindUnique.mockResolvedValue({
      id: "u1", email: "a@b.com", systemRole: "MEMBER", status: "ACTIVE",
      mustChangePassword: false,
      passwordChangedAt: new Date(Date.now() + 60_000), // 미래 → 어떤 발급시각보다도 뒤
      sessionInvalidatedAt: null,
    });
    expect(await verifySession()).toBeNull();
  });
});
