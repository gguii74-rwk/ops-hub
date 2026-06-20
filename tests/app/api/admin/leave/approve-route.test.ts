import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ user: { id: "admin1", systemRole: "OWNER" } } as any)),
  requirePermission: vi.fn(async () => undefined),
  approve: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...args: unknown[]) => unknown)(...a),
  ForbiddenError: class extends Error {},
}));
vi.mock("@/modules/leave/services/requests", () => ({
  approve: (...a: unknown[]) => (h.approve as (...args: unknown[]) => unknown)(...a),
}));
vi.mock("@/app/api/leave/_shared", () => ({ mapError: (e: unknown) => { throw e; } }));

import { POST } from "@/app/api/admin/leave/requests/[id]/approve/route";

const ctx = { params: Promise.resolve({ id: "r1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "admin1", systemRole: "OWNER" } });
});

it("미인증 401", async () => {
  h.auth.mockResolvedValueOnce(null);
  const res = await POST(new Request("http://x"), ctx);
  expect(res.status).toBe(401);
});

it("승인 ok + 권한 검사", async () => {
  const res = await POST(new Request("http://x"), ctx);
  expect(res.status).toBe(200);
  expect(h.requirePermission).toHaveBeenCalledWith("admin1", "leave.approval", "approve");
  expect(h.approve).toHaveBeenCalledWith("r1", "admin1");
});
