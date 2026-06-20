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
vi.mock("@/modules/leave/services/requests", () => ({ listAllRequestsWithUser: vi.fn(async () => []) }));

import { GET } from "@/app/api/admin/leave/approvals/route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/admin/leave/approvals", () => {
  it("미인증이면 401", async () => {
    authMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
  it("leave.approval:view로 가드한다", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    requirePermissionMock.mockResolvedValue(undefined);
    const res = await GET();
    expect(requirePermissionMock).toHaveBeenCalledWith("u1", "leave.approval", "view");
    expect(res.status).toBe(200);
  });
  it("권한 없으면 403", async () => {
    const { ForbiddenError } = await import("@/kernel/access");
    authMock.mockResolvedValue({ user: { id: "u1" } });
    requirePermissionMock.mockRejectedValue(new ForbiddenError("no"));
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
