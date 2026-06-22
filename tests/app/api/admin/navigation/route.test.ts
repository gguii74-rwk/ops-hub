import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    FakeForbidden,
    auth: vi.fn(async () => ({ user: { id: "admin1" } } as any)),
    getPermissionSummary: vi.fn(async () => ({ keys: ["admin.navigation:view"], isOwner: false, isAdmin: true })),
    listNavigationTree: vi.fn(async () => []),
    createNavigationItem: vi.fn(async () => ({ id: "n1" })),
    updateNavigationItem: vi.fn(async () => undefined),
    deleteNavigationItem: vi.fn(async () => undefined),
    reparentNavigationItem: vi.fn(async () => undefined),
    reorderNavigationItems: vi.fn(async () => undefined),
    previewRoles: vi.fn(async () => [{ key: "admin", name: "관리자" }]),
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...x: unknown[]) => unknown)(...a),
  ForbiddenError: h.FakeForbidden,
}));
vi.mock("@/modules/admin/navigation/services", () => ({
  listNavigationTree: (...a: unknown[]) => (h.listNavigationTree as (...x: unknown[]) => unknown)(...a),
  createNavigationItem: (...a: unknown[]) => (h.createNavigationItem as (...x: unknown[]) => unknown)(...a),
  updateNavigationItem: (...a: unknown[]) => (h.updateNavigationItem as (...x: unknown[]) => unknown)(...a),
  deleteNavigationItem: (...a: unknown[]) => (h.deleteNavigationItem as (...x: unknown[]) => unknown)(...a),
  reparentNavigationItem: (...a: unknown[]) => (h.reparentNavigationItem as (...x: unknown[]) => unknown)(...a),
  reorderNavigationItems: (...a: unknown[]) => (h.reorderNavigationItems as (...x: unknown[]) => unknown)(...a),
  previewRoles: (...a: unknown[]) => (h.previewRoles as (...x: unknown[]) => unknown)(...a),
}));

import { GET, POST } from "@/app/api/admin/navigation/route";
import { PATCH, DELETE } from "@/app/api/admin/navigation/[id]/route";
import { mapError } from "@/app/api/admin/navigation/_shared";
import { NavigationConflictError, NavigationValidationError } from "@/modules/admin/navigation/errors";
import { ForbiddenError } from "@/kernel/access";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const AT = "2026-06-22T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "admin1" } });
  h.getPermissionSummary.mockResolvedValue({ keys: ["admin.navigation:view"], isOwner: false, isAdmin: true });
});

describe("_shared mapError", () => {
  it("Forbidden→403, Validation→400, Conflict→409, 미지 에러 재throw", () => {
    expect(mapError(new ForbiddenError("x")).status).toBe(403);
    expect(mapError(new NavigationValidationError("x")).status).toBe(400);
    expect(mapError(new NavigationConflictError("x")).status).toBe(409);
    expect(() => mapError(new Error("boom"))).toThrow("boom");
  });
});

describe("GET /api/admin/navigation", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await GET()).status).toBe(401);
  });
  it("view 없으면 403(서비스 미호출)", async () => {
    h.getPermissionSummary.mockResolvedValueOnce({ keys: [], isOwner: false, isAdmin: false });
    expect((await GET()).status).toBe(403);
    expect(h.listNavigationTree).not.toHaveBeenCalled();
  });
  it("OWNER는 키 없어도 200", async () => {
    h.getPermissionSummary.mockResolvedValueOnce({ keys: [], isOwner: true, isAdmin: true });
    expect((await GET()).status).toBe(200);
  });
  it("정상 200", async () => {
    expect((await GET()).status).toBe(200);
    expect(h.listNavigationTree).toHaveBeenCalled();
  });
});

describe("POST /api/admin/navigation (create)", () => {
  const valid = JSON.stringify({ label: "메뉴", href: "/x", parentId: null, requiredPermissionId: null });
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await POST(new Request("http://x", { method: "POST", body: valid }))).status).toBe(401);
  });
  it("invalid json 400", async () => {
    expect((await POST(new Request("http://x", { method: "POST", body: "{" }))).status).toBe(400);
  });
  it("외부 href는 zod 400(서비스 미호출)", async () => {
    const bad = JSON.stringify({ label: "메뉴", href: "//evil", parentId: null, requiredPermissionId: null });
    expect((await POST(new Request("http://x", { method: "POST", body: bad }))).status).toBe(400);
    expect(h.createNavigationItem).not.toHaveBeenCalled();
  });
  it("정상 201 + 서비스에 session id·입력 위임", async () => {
    const res = await POST(new Request("http://x", { method: "POST", body: valid }));
    expect(res.status).toBe(201);
    expect(h.createNavigationItem).toHaveBeenCalledWith("admin1", expect.objectContaining({ label: "메뉴" }));
    expect(await res.json()).toEqual({ id: "n1" });
  });
  it("서비스 Forbidden→403", async () => {
    h.createNavigationItem.mockRejectedValueOnce(new h.FakeForbidden("no"));
    expect((await POST(new Request("http://x", { method: "POST", body: valid }))).status).toBe(403);
  });
  it("서비스 Conflict→409", async () => {
    h.createNavigationItem.mockRejectedValueOnce(new NavigationConflictError());
    expect((await POST(new Request("http://x", { method: "POST", body: valid }))).status).toBe(409);
  });
});

describe("PATCH /api/admin/navigation/[id]", () => {
  it("empty patch(updatedAt만)는 400", async () => {
    const body = JSON.stringify({ updatedAt: AT });
    const res = await PATCH(new Request("http://x", { method: "PATCH", body }), params("n1"));
    expect(res.status).toBe(400);
    expect(h.updateNavigationItem).not.toHaveBeenCalled();
  });
  it("정상 200 + parseExpectedUpdatedAt 적용", async () => {
    const body = JSON.stringify({ label: "새이름", updatedAt: AT });
    const res = await PATCH(new Request("http://x", { method: "PATCH", body }), params("n1"));
    expect(res.status).toBe(200);
    expect(h.updateNavigationItem).toHaveBeenCalledWith("admin1", "n1", { label: "새이름" }, new Date(AT));
  });
  it("서비스 Conflict→409", async () => {
    h.updateNavigationItem.mockRejectedValueOnce(new NavigationConflictError());
    const body = JSON.stringify({ label: "x", updatedAt: AT });
    expect((await PATCH(new Request("http://x", { method: "PATCH", body }), params("n1"))).status).toBe(409);
  });
});

describe("DELETE /api/admin/navigation/[id]", () => {
  it("정상 200 + updatedAt·confirmedChildIds 서비스 위임", async () => {
    const body = JSON.stringify({ updatedAt: AT, confirmedChildIds: ["c1"] });
    const res = await DELETE(new Request("http://x", { method: "DELETE", body }), params("p1"));
    expect(res.status).toBe(200);
    expect(h.deleteNavigationItem).toHaveBeenCalledWith("admin1", "p1", new Date(AT), ["c1"]);
  });
  it("updatedAt 누락 400", async () => {
    const body = JSON.stringify({ confirmedChildIds: [] });
    const res = await DELETE(new Request("http://x", { method: "DELETE", body }), params("p1"));
    expect(res.status).toBe(400);
  });
  it("confirmedChildIds 누락 400(P9 — fail-closed, 서비스 미호출)", async () => {
    const body = JSON.stringify({ updatedAt: AT });
    const res = await DELETE(new Request("http://x", { method: "DELETE", body }), params("p1"));
    expect(res.status).toBe(400);
    expect(h.deleteNavigationItem).not.toHaveBeenCalled();
  });
});
