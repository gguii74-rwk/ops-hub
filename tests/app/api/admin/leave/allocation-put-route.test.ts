import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ user: { id: "admin1", systemRole: "OWNER" } } as any)),
  requirePermission: vi.fn(async () => undefined),
  setAllocation: vi.fn(async () => ({ id: "alloc1" })),
}));

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...args: unknown[]) => unknown)(...a),
  ForbiddenError: class extends Error {},
}));
vi.mock("@/modules/leave/services/allocations", () => ({
  setAllocation: (...a: unknown[]) => (h.setAllocation as (...args: unknown[]) => unknown)(...a),
}));
vi.mock("@/app/api/leave/_shared", () => ({ mapError: (e: unknown) => { throw e; } }));

import { PUT } from "@/app/api/admin/leave/allocations/[userId]/[year]/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "admin1", systemRole: "OWNER" } });
});

it("미인증 401", async () => {
  h.auth.mockResolvedValueOnce(null);
  const ctx = { params: Promise.resolve({ userId: "u1", year: "2026" }) };
  const res = await PUT(new Request("http://x"), ctx);
  expect(res.status).toBe(401);
});

it("할당 ok + 권한 검사", async () => {
  const ctx = { params: Promise.resolve({ userId: "u1", year: "2026" }) };
  const req = new Request("http://x", {
    method: "PUT",
    body: JSON.stringify({ allocatedDays: 15, carriedOverDays: 0 }),
  });
  const res = await PUT(req, ctx);
  expect(res.status).toBe(200);
  expect(h.requirePermission).toHaveBeenCalledWith("admin1", "leave.allocation", "configure");
  expect(h.setAllocation).toHaveBeenCalledWith("u1", 2026, { allocatedDays: 15, carriedOverDays: 0 });
});

it("유효하지 않은 연도 400", async () => {
  const ctx = { params: Promise.resolve({ userId: "u1", year: "abc" }) };
  const req = new Request("http://x", {
    method: "PUT",
    body: JSON.stringify({ allocatedDays: 15, carriedOverDays: 0 }),
  });
  const res = await PUT(req, ctx);
  expect(res.status).toBe(400);
  // 연도 검사가 requirePermission 전에 일어나므로 권한 호출 없음
  expect(h.requirePermission).not.toHaveBeenCalled();
});
