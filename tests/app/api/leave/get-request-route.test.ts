import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "u1", systemRole: "MEMBER" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: [] as string[] })),
    getRequest: vi.fn(async (): Promise<{ id: string; userId: string } | null> => ({ id: "r1", userId: "u1" })),
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
  getRequest: (...a: unknown[]) => (h.getRequest as (...args: unknown[]) => unknown)(...a),
}));

import { GET } from "@/app/api/leave/requests/[id]/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", systemRole: "MEMBER" } });
  h.getRequest.mockResolvedValue({ id: "r1", userId: "u1" });
});

describe("GET /api/leave/requests/[id]", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    const res = await GET(
      new Request("http://x/api/leave/requests/r1"),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(401);
  });

  it("정상 조회 200", async () => {
    const res = await GET(
      new Request("http://x/api/leave/requests/r1"),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("u1", "leave.request", "view");
    expect(h.getPermissionSummary).toHaveBeenCalledWith("u1");
    expect(h.getRequest).toHaveBeenCalled();
  });

  it("미존재 404", async () => {
    h.getRequest.mockResolvedValueOnce(null);
    const res = await GET(
      new Request("http://x/api/leave/requests/r1"),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(404);
  });
});
