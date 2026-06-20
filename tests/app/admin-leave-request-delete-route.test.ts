import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, requirePermissionMock, deleteByAdminMock } = vi.hoisted(() => ({
  authMock: vi.fn(), requirePermissionMock: vi.fn(), deleteByAdminMock: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/kernel/access", () => ({ requirePermission: requirePermissionMock, ForbiddenError: class ForbiddenError extends Error {} }));
vi.mock("@/modules/leave/services/requests", () => ({ updateByAdmin: vi.fn(), deleteByAdmin: deleteByAdminMock }));

import { DELETE } from "@/app/api/admin/leave/requests/[id]/route";
const params = Promise.resolve({ id: "r1" });
const req = (body?: unknown) => new Request("http://t/api/admin/leave/requests/r1", {
  method: "DELETE", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => vi.clearAllMocks());

describe("DELETE /api/admin/leave/requests/[id]", () => {
  it("미인증이면 401", async () => {
    authMock.mockResolvedValue(null);
    expect((await DELETE(req({ reason: "x" }), { params })).status).toBe(401);
  });
  it("사유 누락이면 400 + 서비스 미호출 + 권한검사 미호출", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const res = await DELETE(req({}), { params });
    expect(res.status).toBe(400);
    expect(deleteByAdminMock).not.toHaveBeenCalled();
    expect(requirePermissionMock).not.toHaveBeenCalled();
  });
  it("공백만인 사유면 400 + 서비스 미호출", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const res = await DELETE(req({ reason: "   " }), { params });
    expect(res.status).toBe(400);
    expect(deleteByAdminMock).not.toHaveBeenCalled();
  });
  it("정상 사유면 권한검사 후 deleteByAdmin(id, actorId, reason) 호출", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    requirePermissionMock.mockResolvedValue(undefined);
    deleteByAdminMock.mockResolvedValue(undefined);
    const res = await DELETE(req({ reason: "오기재 정정" }), { params });
    expect(requirePermissionMock).toHaveBeenCalledWith("u1", "leave.request", "delete");
    expect(deleteByAdminMock).toHaveBeenCalledWith("r1", "u1", "오기재 정정");
    expect(res.status).toBe(200);
  });
});
