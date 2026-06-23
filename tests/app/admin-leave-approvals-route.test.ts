import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, listApprovalQueueMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  listApprovalQueueMock: vi.fn(async () => []),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/kernel/access", () => ({
  ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } },
}));
vi.mock("@/modules/leave/services/requests", () => ({
  listApprovalQueue: (...a: unknown[]) => (listApprovalQueueMock as (...args: unknown[]) => unknown)(...a),
}));

import { GET } from "@/app/api/admin/leave/approvals/route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/admin/leave/approvals", () => {
  it("미인증이면 401", async () => {
    authMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
  it("listApprovalQueue(session.user.id)를 호출하고 200 반환", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listApprovalQueueMock.mockResolvedValue([]);
    const res = await GET();
    expect(listApprovalQueueMock).toHaveBeenCalledWith("u1");
    expect(res.status).toBe(200);
  });
  it("leave.approval:view로 가드한다 — listApprovalQueue가 ForbiddenError 던지면 403", async () => {
    const { ForbiddenError } = await import("@/kernel/access");
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listApprovalQueueMock.mockRejectedValue(new ForbiddenError("no"));
    const res = await GET();
    expect(res.status).toBe(403);
  });
  it("권한 없으면 403", async () => {
    const { ForbiddenError } = await import("@/kernel/access");
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listApprovalQueueMock.mockRejectedValue(new ForbiddenError("no"));
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
