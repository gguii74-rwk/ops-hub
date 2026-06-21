import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "admin1", systemRole: "ADMIN" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: ["admin.users:view", "admin.users:update"], isOwner: false })),
    getUserForEdit: vi.fn(async () => ({ id: "u1", email: "u1@x.com" } as { id: string; email: string } | null)),
    updateUser: vi.fn(async () => undefined),
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
  getUserForEdit: (...a: unknown[]) => (h.getUserForEdit as (...x: unknown[]) => unknown)(...a),
  updateUser: (...a: unknown[]) => (h.updateUser as (...x: unknown[]) => unknown)(...a),
}));

import { GET, PATCH } from "@/app/api/admin/users/[id]/route";
import { EscalationError } from "@/modules/admin/users/errors";

const ctx = { params: Promise.resolve({ id: "u1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "admin1", systemRole: "ADMIN" } });
  h.getPermissionSummary.mockResolvedValue({ keys: ["admin.users:view", "admin.users:update"], isOwner: false });
});

describe("GET /api/admin/users/[id]", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://x"), ctx)).status).toBe(401);
  });
  it("정상 200 + :view 검사 + ctx·id 위임", async () => {
    const res = await GET(new Request("http://x"), ctx);
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("admin1", "admin.users", "view");
    expect(h.getUserForEdit).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin1" }), "u1");
  });
  it("대상 없음(null)이면 404", async () => {
    h.getUserForEdit.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://x"), ctx)).status).toBe(404);
  });
});

describe("PATCH /api/admin/users/[id]", () => {
  const valid = JSON.stringify({ name: "수정", systemRole: "MEMBER" });
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await PATCH(new Request("http://x", { method: "PATCH", body: valid }), ctx)).status).toBe(401);
  });
  it("invalid json 400", async () => {
    expect((await PATCH(new Request("http://x", { method: "PATCH", body: "{" }), ctx)).status).toBe(400);
  });
  it("zod 위반 400(service 미호출)", async () => {
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ systemRole: "GOD" }) }), ctx);
    expect(res.status).toBe(400);
    expect(h.updateUser).not.toHaveBeenCalled();
  });
  it("빈 patch(알려진 필드 0개)는 400(finding E — status 등 unknown 키가 strip돼 빈 patch로 성공하는 것 방지, service 미호출)", async () => {
    // status는 PATCH 스키마에 없는 키 → zod strip 후 patch가 빈 객체. 라우트가 키 0개를 400으로 거부해야 한다.
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "DISABLED" }) }), ctx);
    expect(res.status).toBe(400);
    expect(h.updateUser).not.toHaveBeenCalled();
  });
  it("정상 200 + :update 검사 + ctx·id·patch 위임", async () => {
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: valid }), ctx);
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("admin1", "admin.users", "update");
    expect(h.updateUser).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin1" }), "u1", expect.objectContaining({ name: "수정", systemRole: "MEMBER" }));
  });
  it("service가 EscalationError(D12: 비-OWNER가 OWNER/ADMIN 부여)면 403", async () => {
    h.updateUser.mockRejectedValueOnce(new EscalationError("OWNER만 systemRole을 OWNER/ADMIN으로 설정할 수 있습니다."));
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ systemRole: "OWNER" }) }), ctx);
    expect(res.status).toBe(403);
  });
});
