import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "admin1", systemRole: "ADMIN" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: ["admin.users:update"], isOwner: false })),
    assignRoles: vi.fn(async () => undefined),
    upsertOverride: vi.fn(async () => ({ id: "ov1" })),
    removeOverride: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => ({ temporaryPassword: "Temp-12345678" })),
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
  assignRoles: (...a: unknown[]) => (h.assignRoles as (...x: unknown[]) => unknown)(...a),
  upsertOverride: (...a: unknown[]) => (h.upsertOverride as (...x: unknown[]) => unknown)(...a),
  removeOverride: (...a: unknown[]) => (h.removeOverride as (...x: unknown[]) => unknown)(...a),
  resetPassword: (...a: unknown[]) => (h.resetPassword as (...x: unknown[]) => unknown)(...a),
}));

import { POST as setRoles } from "@/app/api/admin/users/[id]/roles/route";
import { POST as addOverride, DELETE as delOverride } from "@/app/api/admin/users/[id]/overrides/route";
import { POST as resetPw } from "@/app/api/admin/users/[id]/reset-password/route";
import { EscalationError, MinAvailabilityError } from "@/modules/admin/users/errors";

const ctx = { params: Promise.resolve({ id: "u1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "admin1", systemRole: "ADMIN" } });
  h.getPermissionSummary.mockResolvedValue({ keys: ["admin.users:update"], isOwner: false });
});

describe("POST .../[id]/roles", () => {
  const valid = JSON.stringify({ roleKeys: ["developer"] });
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await setRoles(new Request("http://x", { method: "POST", body: valid }), ctx)).status).toBe(401);
  });
  it("zod 위반 400", async () => {
    const res = await setRoles(new Request("http://x", { method: "POST", body: JSON.stringify({ roleKeys: "nope" }) }), ctx);
    expect(res.status).toBe(400);
    expect(h.assignRoles).not.toHaveBeenCalled();
  });
  it("정상 200 + :update 검사 + ctx·id·roleKeys 위임", async () => {
    const res = await setRoles(new Request("http://x", { method: "POST", body: valid }), ctx);
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("admin1", "admin.users", "update");
    expect(h.assignRoles).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin1" }), "u1", ["developer"]);
  });
  it("service가 EscalationError(D13ⓑ: 특권 역할)면 403", async () => {
    h.assignRoles.mockRejectedValueOnce(new EscalationError("특권 역할 부여는 OWNER만 가능합니다."));
    expect((await setRoles(new Request("http://x", { method: "POST", body: JSON.stringify({ roleKeys: ["admin"] }) }), ctx)).status).toBe(403);
  });
  it("service가 MinAvailabilityError(D13ⓔ: 마지막 관리자)면 409", async () => {
    h.assignRoles.mockRejectedValueOnce(new MinAvailabilityError("최소 1명의 사용자 관리자가 필요합니다."));
    expect((await setRoles(new Request("http://x", { method: "POST", body: valid }), ctx)).status).toBe(409);
  });
});

describe("POST .../[id]/overrides", () => {
  const valid = JSON.stringify({ resource: "leave.approval", action: "view", effect: "ALLOW", scope: "all", reason: "임시", startsAt: null, endsAt: null });
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await addOverride(new Request("http://x", { method: "POST", body: valid }), ctx)).status).toBe(401);
  });
  it("zod 위반 400", async () => {
    const res = await addOverride(new Request("http://x", { method: "POST", body: JSON.stringify({ effect: "MAYBE" }) }), ctx);
    expect(res.status).toBe(400);
    expect(h.upsertOverride).not.toHaveBeenCalled();
  });
  it("정상 201 + :update 검사 + ctx·id·override 위임 + 생성 id 반환", async () => {
    const res = await addOverride(new Request("http://x", { method: "POST", body: valid }), ctx);
    expect(res.status).toBe(201);
    expect(h.requirePermission).toHaveBeenCalledWith("admin1", "admin.users", "update");
    expect(h.upsertOverride).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin1" }), "u1", expect.objectContaining({ resource: "leave.approval", effect: "ALLOW" }));
    expect(await res.json()).toEqual({ id: "ov1" });
  });
  it("service가 EscalationError(D13ⓒ/ⓓ: 미보유 ALLOW·critical DENY)면 403", async () => {
    h.upsertOverride.mockRejectedValueOnce(new EscalationError("보유하지 않은 권한은 부여할 수 없습니다."));
    expect((await addOverride(new Request("http://x", { method: "POST", body: valid }), ctx)).status).toBe(403);
  });
});

describe("DELETE .../[id]/overrides", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await delOverride(new Request("http://x?overrideId=ov1", { method: "DELETE" }), ctx)).status).toBe(401);
  });
  it("overrideId 쿼리 누락 400(service 미호출)", async () => {
    const res = await delOverride(new Request("http://x", { method: "DELETE" }), ctx);
    expect(res.status).toBe(400);
    expect(h.removeOverride).not.toHaveBeenCalled();
  });
  it("정상 200 + :update 검사 + ctx·id·overrideId 위임", async () => {
    const res = await delOverride(new Request("http://x?overrideId=ov1", { method: "DELETE" }), ctx);
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("admin1", "admin.users", "update");
    expect(h.removeOverride).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin1" }), "u1", "ov1");
  });
  it("service가 MinAvailabilityError(ALLOW 제거가 마지막 관리자 lockout)면 409", async () => {
    h.removeOverride.mockRejectedValueOnce(new MinAvailabilityError("최소 가용 관리자 보존 위반"));
    expect((await delOverride(new Request("http://x?overrideId=ov1", { method: "DELETE" }), ctx)).status).toBe(409);
  });
});

describe("POST .../[id]/reset-password", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await resetPw(new Request("http://x", { method: "POST" }), ctx)).status).toBe(401);
  });
  it("정상 200 + :update 검사 + ctx·id 위임 + 임시비번 반환", async () => {
    const res = await resetPw(new Request("http://x", { method: "POST" }), ctx);
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("admin1", "admin.users", "update");
    expect(h.resetPassword).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin1" }), "u1");
    expect(await res.json()).toEqual({ temporaryPassword: "Temp-12345678" });
  });
  it("service가 EscalationError(D14: 위임 admin이 특권 대상 재설정)면 403", async () => {
    h.resetPassword.mockRejectedValueOnce(new EscalationError("특권 대상 재설정은 OWNER만 가능합니다."));
    expect((await resetPw(new Request("http://x", { method: "POST" }), ctx)).status).toBe(403);
  });
  it("service가 MinAvailabilityError(D14: 마지막 관리자를 must-change로)면 409", async () => {
    h.resetPassword.mockRejectedValueOnce(new MinAvailabilityError("최소 가용 관리자 보존 위반"));
    expect((await resetPw(new Request("http://x", { method: "POST" }), ctx)).status).toBe(409);
  });
});
