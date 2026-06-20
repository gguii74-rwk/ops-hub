import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "u1", systemRole: "MEMBER" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getAllocationSummary: vi.fn(async () => ({ totalDays: 15, usedDays: 3 })),
    FakeForbidden,
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...args: unknown[]) => unknown)(...a),
  ForbiddenError: h.FakeForbidden,
}));
vi.mock("@/modules/leave/services/allocations", () => ({
  getAllocationSummary: (...a: unknown[]) => (h.getAllocationSummary as (...args: unknown[]) => unknown)(...a),
}));

import { GET } from "@/app/api/leave/summary/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", systemRole: "MEMBER" } });
});

describe("GET /api/leave/summary", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x/api/leave/summary"));
    expect(res.status).toBe(401);
  });

  it("정상 조회 200", async () => {
    h.getAllocationSummary.mockResolvedValue({ totalDays: 15, usedDays: 3 });
    const res = await GET(new Request("http://x/api/leave/summary"));
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("u1", "leave.request", "view");
    expect(h.getAllocationSummary).toHaveBeenCalled();
  });
});
