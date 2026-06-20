import { expect, vi, beforeEach, it } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ user: { id: "admin1", systemRole: "OWNER" } } as any)),
  requirePermission: vi.fn(async () => undefined),
  getAllEmployeesStatus: vi.fn(async () => []),
}));

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...args: unknown[]) => unknown)(...a),
  ForbiddenError: class extends Error {},
}));
vi.mock("@/modules/leave/services/status", () => ({
  getAllEmployeesStatus: (...a: unknown[]) =>
    (h.getAllEmployeesStatus as (...args: unknown[]) => unknown)(...a),
}));

import { GET } from "@/app/api/admin/leave/status/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "admin1", systemRole: "OWNER" } });
});

it("미인증 401", async () => {
  h.auth.mockResolvedValueOnce(null);
  const res = await GET(new Request("http://x?year=2026"));
  expect(res.status).toBe(401);
});

it("현황 ok + 권한 검사", async () => {
  const res = await GET(new Request("http://x?year=2026"));
  expect(res.status).toBe(200);
  expect(h.requirePermission).toHaveBeenCalledWith("admin1", "leave.status", "view");
});

it("권한 없음 403", async () => {
  const { ForbiddenError } = await import("@/kernel/access");
  h.requirePermission.mockRejectedValueOnce(new ForbiddenError());
  const res = await GET(new Request("http://x?year=2026"));
  expect(res.status).toBe(403);
});
