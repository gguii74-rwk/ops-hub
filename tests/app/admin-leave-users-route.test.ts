import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, requirePermissionMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  requirePermissionMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/kernel/access", () => ({
  requirePermission: requirePermissionMock,
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock("@/modules/leave/services/users", () => ({ listActiveUsers: vi.fn(async () => []) }));

import { GET } from "@/app/api/admin/leave/users/route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/admin/leave/users", () => {
  it("미인증 401", async () => {
    authMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
  it("leave.approval:approve로 가드", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    requirePermissionMock.mockResolvedValue(undefined);
    expect((await GET()).status).toBe(200);
    expect(requirePermissionMock).toHaveBeenCalledWith("u1", "leave.approval", "approve");
  });
  it("권한 없으면 403", async () => {
    const { ForbiddenError } = await import("@/kernel/access");
    authMock.mockResolvedValue({ user: { id: "u1" } });
    requirePermissionMock.mockRejectedValue(new ForbiddenError("no"));
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
