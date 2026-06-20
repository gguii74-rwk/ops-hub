import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "u1", systemRole: "MEMBER" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: [] as string[] })),
    createLeaveRequest: vi.fn(async () => ({ id: "r1" })),
    listMyRequests: vi.fn(async () => [] as any[]),
    FakeForbidden,
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...args: unknown[]) => unknown)(...a),
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...args: unknown[]) => unknown)(...a),
  ForbiddenError: h.FakeForbidden,
}));
vi.mock("@/modules/leave/services/requests", () => ({
  createLeaveRequest: (...a: unknown[]) => (h.createLeaveRequest as (...args: unknown[]) => unknown)(...a),
  listMyRequests: (...a: unknown[]) => (h.listMyRequests as (...args: unknown[]) => unknown)(...a),
}));

import { GET, POST } from "@/app/api/leave/requests/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", systemRole: "MEMBER" } });
});

describe("POST /api/leave/requests", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://x/api/leave/requests", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });
  it("잘못된 입력 400", async () => {
    const res = await POST(new Request("http://x/api/leave/requests", { method: "POST", body: JSON.stringify({ leaveType: "BOGUS" }) }));
    expect(res.status).toBe(400);
  });
  it("정상 신청 201", async () => {
    h.createLeaveRequest.mockResolvedValue({ id: "r1" });
    const body = JSON.stringify({ leaveType: "ANNUAL", startDate: "2999-08-14", endDate: "2999-08-14" });
    const res = await POST(new Request("http://x/api/leave/requests", { method: "POST", body }));
    expect(res.status).toBe(201);
    expect(h.requirePermission).toHaveBeenCalledWith("u1", "leave.request", "create");
  });
});

describe("GET /api/leave/requests", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x/api/leave/requests"));
    expect(res.status).toBe(401);
  });
});
