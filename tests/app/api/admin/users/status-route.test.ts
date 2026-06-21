import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "admin1", systemRole: "ADMIN" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: ["admin.users:update"], isOwner: false })),
    setUserStatus: vi.fn(async () => undefined),
    FakeForbidden,
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...x: unknown[]) => unknown)(...a),
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...x: unknown[]) => unknown)(...a),
  ForbiddenError: h.FakeForbidden,
}));
vi.mock("@/modules/admin/users/services", () => ({
  setUserStatus: (...a: unknown[]) => (h.setUserStatus as (...x: unknown[]) => unknown)(...a),
}));

import { POST as setStatus } from "@/app/api/admin/users/[id]/status/route";
import { EscalationError, MinAvailabilityError } from "@/modules/admin/users/errors";

const ctx = { params: Promise.resolve({ id: "u1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "admin1", systemRole: "ADMIN" } });
  h.getPermissionSummary.mockResolvedValue({ keys: ["admin.users:update"], isOwner: false });
});

describe("POST /api/admin/users/[id]/status (finding E — 상태 토글 전용)", () => {
  const disable = JSON.stringify({ status: "DISABLED" });
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await setStatus(new Request("http://x", { method: "POST", body: disable }), ctx)).status).toBe(401);
  });
  it("invalid json 400", async () => {
    expect((await setStatus(new Request("http://x", { method: "POST", body: "{" }), ctx)).status).toBe(400);
  });
  it("status enum 위반 400(service 미호출)", async () => {
    const res = await setStatus(new Request("http://x", { method: "POST", body: JSON.stringify({ status: "BOGUS" }) }), ctx);
    expect(res.status).toBe(400);
    expect(h.setUserStatus).not.toHaveBeenCalled();
  });
  it("ACTIVE→DISABLED 정상 200 + :update 검사 + ctx·id·status 위임(세션무효화는 service 책임)", async () => {
    const res = await setStatus(new Request("http://x", { method: "POST", body: disable }), ctx);
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("admin1", "admin.users", "update");
    expect(h.setUserStatus).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin1" }), "u1", "DISABLED");
  });
  it("DISABLED→ACTIVE 재활성도 같은 경로로 위임", async () => {
    const res = await setStatus(new Request("http://x", { method: "POST", body: JSON.stringify({ status: "ACTIVE" }) }), ctx);
    expect(res.status).toBe(200);
    expect(h.setUserStatus).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin1" }), "u1", "ACTIVE");
  });
  it("service가 MinAvailabilityError(마지막 관리자 비활성화)면 409", async () => {
    h.setUserStatus.mockRejectedValueOnce(new MinAvailabilityError("최소 1명의 사용자 관리자가 필요합니다."));
    expect((await setStatus(new Request("http://x", { method: "POST", body: disable }), ctx)).status).toBe(409);
  });
  it("service가 EscalationError(특권 대상/자가 비활성화)면 403", async () => {
    h.setUserStatus.mockRejectedValueOnce(new EscalationError("특권 대상 상태 변경은 OWNER만 가능합니다."));
    expect((await setStatus(new Request("http://x", { method: "POST", body: disable }), ctx)).status).toBe(403);
  });
});
