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
vi.mock("@/modules/leave/services/requests", () => ({
  listAllRequestsWithUser: vi.fn(async () => []),
  createLeaveRequestByAdmin: vi.fn(),
}));
vi.mock("@/modules/leave/validations", () => ({
  adminCreateLeaveSchema: { safeParse: vi.fn(() => ({ success: false })) },
}));

import { GET, POST } from "@/app/api/admin/leave/requests/route";

const makeReq = (url = "http://localhost/api/admin/leave/requests") =>
  new Request(url);

beforeEach(() => vi.clearAllMocks());

describe("GET /api/admin/leave/requests", () => {
  it("미인증이면 401", async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("leave.admin:view로 가드한다", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    requirePermissionMock.mockResolvedValue(undefined);
    const res = await GET(makeReq());
    expect(requirePermissionMock).toHaveBeenCalledWith("u1", "leave.admin", "view");
    expect(res.status).toBe(200);
  });

  it("권한 없으면 403", async () => {
    const { ForbiddenError } = await import("@/kernel/access");
    authMock.mockResolvedValue({ user: { id: "u1" } });
    requirePermissionMock.mockRejectedValue(new ForbiddenError("no"));
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/leave/requests", () => {
  it("POST는 leave.approval:approve로 가드한다", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    // 바디 파싱 실패(빈 문자열) → 400 반환 전에 requirePermission은 호출되지 않음
    // → adminCreateLeaveSchema.safeParse가 실패하면 400으로 조기 반환
    // POST 가드를 검증하려면 safeParse가 성공해야 함 — 별도 mock override
    const { adminCreateLeaveSchema } = await import("@/modules/leave/validations");
    vi.mocked(adminCreateLeaveSchema.safeParse).mockReturnValueOnce({
      success: true,
      data: { userId: "u2", leaveType: "ANNUAL", startDate: "2026-07-01", endDate: "2026-07-01" },
    } as ReturnType<typeof adminCreateLeaveSchema.safeParse>);
    requirePermissionMock.mockResolvedValue(undefined);
    const { createLeaveRequestByAdmin } = await import("@/modules/leave/services/requests");
    vi.mocked(createLeaveRequestByAdmin).mockResolvedValueOnce({ id: "r1" } as Awaited<ReturnType<typeof createLeaveRequestByAdmin>>);
    const req = new Request("http://localhost/api/admin/leave/requests", {
      method: "POST",
      body: JSON.stringify({ userId: "u2", leaveType: "ANNUAL", startDate: "2026-07-01", endDate: "2026-07-01" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(requirePermissionMock).toHaveBeenCalledWith("u1", "leave.approval", "approve");
    expect(res.status).toBe(201);
  });
});
