import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "admin1", systemRole: "ADMIN" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: ["admin.users:view", "admin.users:create"], isOwner: false })),
    listUsersForView: vi.fn(async () => ({ rows: [], total: 0, pendingCount: 0 })),
    createUserByAdmin: vi.fn(async () => ({ id: "u-new" })),
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
  listUsersForView: (...a: unknown[]) => (h.listUsersForView as (...x: unknown[]) => unknown)(...a),
  createUserByAdmin: (...a: unknown[]) => (h.createUserByAdmin as (...x: unknown[]) => unknown)(...a),
}));

import { GET, POST } from "@/app/api/admin/users/route";
import { buildActorCtx, mapError } from "@/app/api/admin/users/_shared";
import {
  EscalationError, MinAvailabilityError, RateLimitError, TokenError,
  UserConflictError, UserValidationError,
} from "@/modules/admin/users/errors";
import { ForbiddenError } from "@/kernel/access";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "admin1", systemRole: "ADMIN" } });
  h.getPermissionSummary.mockResolvedValue({ keys: ["admin.users:view", "admin.users:create"], isOwner: false });
});

describe("_shared mapError (S4)", () => {
  it("Forbidden/Escalation→403, Conflict/MinAvailability→409, Validation/Token→400, RateLimit→429", () => {
    expect(mapError(new ForbiddenError("x")).status).toBe(403);
    expect(mapError(new EscalationError("x")).status).toBe(403);
    expect(mapError(new UserConflictError("x")).status).toBe(409);
    expect(mapError(new MinAvailabilityError("x")).status).toBe(409);
    expect(mapError(new UserValidationError("x")).status).toBe(400);
    expect(mapError(new TokenError("x")).status).toBe(400);
    expect(mapError(new RateLimitError("x")).status).toBe(429);
  });
  it("알 수 없는 에러는 재throw(삼켜서 500을 숨기지 않음)", () => {
    expect(() => mapError(new Error("boom"))).toThrow("boom");
  });
});

describe("_shared buildActorCtx (S5·finding 3 — isOwner는 summary 단일 권위)", () => {
  it("summary.isOwner=true면 isOwner=true, permissionKeys=Set(keys)", () => {
    // isAdmin: false added to satisfy PermissionSummary (task-07 drift: isAdmin required)
    const ctx = buildActorCtx({ id: "o1" } as any, { keys: ["admin.users:view"], isOwner: true, isAdmin: false });
    expect(ctx).toEqual({ userId: "o1", isOwner: true, permissionKeys: new Set(["admin.users:view"]) });
  });
  it("summary.isOwner=false면 isOwner=false — stale session.user.systemRole(OWNER)은 무시(finding 3)", () => {
    // isAdmin: false added to satisfy PermissionSummary (task-07 drift: isAdmin required)
    const ctx = buildActorCtx({ id: "a1", systemRole: "OWNER" } as any, { keys: [], isOwner: false, isAdmin: false });
    expect(ctx.isOwner).toBe(false); // 권위는 summary, 세션 스냅샷 아님
  });
});

describe("GET /api/admin/users", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x/api/admin/users"));
    expect(res.status).toBe(401);
  });
  it("정상 조회 200 + admin.users:view 검사 + ActorContext·필터 위임", async () => {
    const res = await GET(new Request("http://x/api/admin/users?status=PENDING&q=kim&page=2&pageSize=20"));
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("admin1", "admin.users", "view");
    expect(h.listUsersForView).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "admin1", isOwner: false, permissionKeys: new Set(["admin.users:view", "admin.users:create"]) }),
      expect.objectContaining({ status: "PENDING", q: "kim", page: 2, pageSize: 20 }),
    );
  });
  it("잘못된 status 쿼리는 400(service 미호출)", async () => {
    const res = await GET(new Request("http://x/api/admin/users?status=BOGUS"));
    expect(res.status).toBe(400);
    expect(h.listUsersForView).not.toHaveBeenCalled();
  });
  it("잘못된 employmentType 쿼리는 400(service 미호출)", async () => {
    const res = await GET(new Request("http://x/api/admin/users?employmentType=BOGUS"));
    expect(res.status).toBe(400);
    expect(h.listUsersForView).not.toHaveBeenCalled();
  });
  it("잘못된 jobFunction 쿼리는 400(service 미호출)", async () => {
    const res = await GET(new Request("http://x/api/admin/users?jobFunction=BOGUS"));
    expect(res.status).toBe(400);
    expect(h.listUsersForView).not.toHaveBeenCalled();
  });
  it("pageSize 상한 초과(99999)는 100으로 클램프 후 200 + service 호출", async () => {
    const res = await GET(new Request("http://x/api/admin/users?pageSize=99999"));
    expect(res.status).toBe(200);
    expect(h.listUsersForView).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pageSize: 100 }),
    );
  });
  it("권한 없으면 403(requirePermission throw → mapError)", async () => {
    h.requirePermission.mockRejectedValueOnce(new h.FakeForbidden("denied"));
    const res = await GET(new Request("http://x/api/admin/users"));
    expect(res.status).toBe(403);
    expect(h.listUsersForView).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/users (직접추가)", () => {
  const valid = JSON.stringify({
    // finding 3: 직접추가 요청 비번 필드는 adminCreateSchema와 동일한 `password`로 통일(이전 temporaryPassword는 검증 실패).
    email: "new@x.com", name: "신규", password: "tempPass1234",
    employmentType: "REGULAR", jobFunction: "DEVELOPER", department: null,
    systemRole: "MEMBER", roleKeys: ["developer"],
  });
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://x/api/admin/users", { method: "POST", body: valid }));
    expect(res.status).toBe(401);
  });
  it("invalid json 400", async () => {
    const res = await POST(new Request("http://x/api/admin/users", { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
  });
  it("zod 위반 400(service 미호출)", async () => {
    const res = await POST(new Request("http://x/api/admin/users", { method: "POST", body: JSON.stringify({ email: "bad" }) }));
    expect(res.status).toBe(400);
    expect(h.createUserByAdmin).not.toHaveBeenCalled();
  });
  it("정상 201 + admin.users:create 검사 + ActorContext·입력 위임", async () => {
    const res = await POST(new Request("http://x/api/admin/users", { method: "POST", body: valid }));
    expect(res.status).toBe(201);
    expect(h.requirePermission).toHaveBeenCalledWith("admin1", "admin.users", "create");
    expect(h.createUserByAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "admin1", isOwner: false }),
      expect.objectContaining({ email: "new@x.com", roleKeys: ["developer"], systemRole: "MEMBER" }),
    );
    expect(await res.json()).toEqual({ id: "u-new" });
  });
  it("service가 EscalationError(D13: 비-OWNER가 특권역할 부여)면 403", async () => {
    h.createUserByAdmin.mockRejectedValueOnce(new EscalationError("위임 admin은 특권 역할을 부여할 수 없습니다."));
    const res = await POST(new Request("http://x/api/admin/users", { method: "POST", body: valid }));
    expect(res.status).toBe(403);
  });
  it("service가 UserConflictError(중복 이메일)면 409", async () => {
    h.createUserByAdmin.mockRejectedValueOnce(new UserConflictError("이미 등록된 이메일입니다."));
    const res = await POST(new Request("http://x/api/admin/users", { method: "POST", body: valid }));
    expect(res.status).toBe(409);
  });
});
