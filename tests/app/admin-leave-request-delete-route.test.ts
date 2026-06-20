import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, requirePermissionMock, deleteByAdminMock, updateByAdminMock } = vi.hoisted(() => ({
  authMock: vi.fn(), requirePermissionMock: vi.fn(), deleteByAdminMock: vi.fn(), updateByAdminMock: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/kernel/access", () => ({ requirePermission: requirePermissionMock, ForbiddenError: class ForbiddenError extends Error {} }));
vi.mock("@/modules/leave/services/requests", () => ({ updateByAdmin: updateByAdminMock, deleteByAdmin: deleteByAdminMock }));

import { DELETE, PATCH } from "@/app/api/admin/leave/requests/[id]/route";
const params = Promise.resolve({ id: "r1" });
const req = (body?: unknown) => new Request("http://t/api/admin/leave/requests/r1", {
  method: "DELETE", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});
const patchReq = (body: unknown = {}) => new Request("http://t/api/admin/leave/requests/r1", {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
// admin:view만 거부하는 mock(다른 키는 통과) — 규칙 #1 게이트 검증용.
const denyAdminView = async (_id: string, resource: string, action: string) => {
  if (resource === "leave.admin" && action === "view") {
    const { ForbiddenError } = await import("@/kernel/access");
    throw new ForbiddenError("no admin");
  }
};

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
    expect(requirePermissionMock).toHaveBeenCalledWith("u1", "leave.admin", "view");
    expect(requirePermissionMock).toHaveBeenCalledWith("u1", "leave.request", "delete");
    expect(deleteByAdminMock).toHaveBeenCalledWith("r1", "u1", "오기재 정정");
    expect(res.status).toBe(200);
  });
  it("admin:view 없으면 403(request:delete만으론 불가·규칙 #1) + 서비스 미호출", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    requirePermissionMock.mockImplementation(denyAdminView);
    const res = await DELETE(req({ reason: "오기재 정정" }), { params });
    expect(res.status).toBe(403);
    expect(deleteByAdminMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/leave/requests/[id]", () => {
  it("미인증이면 401", async () => {
    authMock.mockResolvedValue(null);
    expect((await PATCH(patchReq(), { params })).status).toBe(401);
  });
  it("admin:view + request:update 둘 다 검사 후 updateByAdmin 호출", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    requirePermissionMock.mockResolvedValue(undefined);
    updateByAdminMock.mockResolvedValue({ id: "r1" });
    const res = await PATCH(patchReq({ adminActionNote: "정정" }), { params });
    expect(requirePermissionMock).toHaveBeenCalledWith("u1", "leave.admin", "view");
    expect(requirePermissionMock).toHaveBeenCalledWith("u1", "leave.request", "update");
    expect(updateByAdminMock).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
  it("admin:view 없으면 403(request:update만으론 불가·규칙 #1) + 서비스 미호출", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    requirePermissionMock.mockImplementation(denyAdminView);
    const res = await PATCH(patchReq({ adminActionNote: "x" }), { params });
    expect(res.status).toBe(403);
    expect(updateByAdminMock).not.toHaveBeenCalled();
  });
});
