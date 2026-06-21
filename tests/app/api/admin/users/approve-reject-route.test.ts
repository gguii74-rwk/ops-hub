import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "admin1", systemRole: "ADMIN" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: ["admin.users:approve"], isOwner: false })),
    approveUser: vi.fn(async () => undefined),
    rejectUser: vi.fn(async () => undefined),
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
  approveUser: (...a: unknown[]) => (h.approveUser as (...x: unknown[]) => unknown)(...a),
  rejectUser: (...a: unknown[]) => (h.rejectUser as (...x: unknown[]) => unknown)(...a),
}));

import { POST as approve } from "@/app/api/admin/users/[id]/approve/route";
import { POST as reject } from "@/app/api/admin/users/[id]/reject/route";
import { EscalationError, UserConflictError } from "@/modules/admin/users/errors";

const ctx = { params: Promise.resolve({ id: "u1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "admin1", systemRole: "ADMIN" } });
  h.getPermissionSummary.mockResolvedValue({ keys: ["admin.users:approve"], isOwner: false });
});

describe("POST .../[id]/approve", () => {
  const valid = JSON.stringify({ employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: ["developer"] });
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await approve(new Request("http://x", { method: "POST", body: valid }), ctx)).status).toBe(401);
  });
  it("zod 위반 400(service 미호출)", async () => {
    const res = await approve(new Request("http://x", { method: "POST", body: JSON.stringify({}) }), ctx);
    expect(res.status).toBe(400);
    expect(h.approveUser).not.toHaveBeenCalled();
  });
  it("정상 200 + admin.users:approve 검사 + ctx·id·decision 위임", async () => {
    const res = await approve(new Request("http://x", { method: "POST", body: valid }), ctx);
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("admin1", "admin.users", "approve");
    expect(h.approveUser).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin1" }), "u1", expect.objectContaining({ roleKeys: ["developer"], systemRole: "MEMBER" }));
  });
  it("service가 UserConflictError(더블승인 CAS/미검증)면 409", async () => {
    h.approveUser.mockRejectedValueOnce(new UserConflictError("이미 처리된 신청입니다."));
    expect((await approve(new Request("http://x", { method: "POST", body: valid }), ctx)).status).toBe(409);
  });
  it("service가 EscalationError(D13: 위임 admin이 특권 역할 확정)면 403", async () => {
    h.approveUser.mockRejectedValueOnce(new EscalationError("위임 admin은 특권 역할을 부여할 수 없습니다."));
    expect((await approve(new Request("http://x", { method: "POST", body: valid }), ctx)).status).toBe(403);
  });
});

describe("POST .../[id]/reject", () => {
  const valid = JSON.stringify({ reason: "자격 미달" });
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await reject(new Request("http://x", { method: "POST", body: valid }), ctx)).status).toBe(401);
  });
  it("정상 200 + admin.users:approve 검사 + ctx·id·reason 위임", async () => {
    const res = await reject(new Request("http://x", { method: "POST", body: valid }), ctx);
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("admin1", "admin.users", "approve");
    expect(h.rejectUser).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin1" }), "u1", "자격 미달");
  });
  it("service가 UserConflictError(CAS 충돌)면 409", async () => {
    h.rejectUser.mockRejectedValueOnce(new UserConflictError("이미 처리된 신청입니다."));
    expect((await reject(new Request("http://x", { method: "POST", body: valid }), ctx)).status).toBe(409);
  });
});
