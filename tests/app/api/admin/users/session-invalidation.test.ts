import { describe, it, expect, vi, beforeEach } from "vitest";

// task-07이 만든 세션 유효성 판정 헬퍼를 직접 검증(순수 함수: tokenIat(초) + DB 스냅샷 → boolean).
// §S9 확정 시그니처: isSessionValid(tokenIat: number, snap: {status, passwordChangedAt, sessionInvalidatedAt}).
// 헬퍼명/시그니처는 task-07 §S9 구현을 따른다. 본 import가 그 계약을 고정한다.
import { isSessionValid } from "@/lib/auth/session-validity";

const tokenIssuedAt = new Date("2026-06-10T00:00:00Z");
const tokenIat = Math.floor(tokenIssuedAt.getTime() / 1000); // JWT iat는 초 단위

describe("isSessionValid (§S9 — status fail-closed + sessionInvalidatedAt/passwordChangedAt iat 비교)", () => {
  it("ACTIVE + 무효화 시각 없음 → 유효", () => {
    expect(isSessionValid(tokenIat, { status: "ACTIVE", sessionInvalidatedAt: null, passwordChangedAt: null })).toBe(true);
  });
  it("status가 DISABLED면 무효(즉시 차단, 토큰 만료 전)", () => {
    expect(isSessionValid(tokenIat, { status: "DISABLED", sessionInvalidatedAt: null, passwordChangedAt: null })).toBe(false);
  });
  it("sessionInvalidatedAt > 토큰 발급시각이면 무효(비활성화 직후 발급된 토큰만 유효)", () => {
    const invalidatedAfter = new Date(tokenIssuedAt.getTime() + 60_000);
    expect(isSessionValid(tokenIat, { status: "ACTIVE", sessionInvalidatedAt: invalidatedAfter, passwordChangedAt: null })).toBe(false);
  });
  it("sessionInvalidatedAt이 토큰 발급 이전이면 유효(재로그인 후 새 토큰)", () => {
    const invalidatedBefore = new Date(tokenIssuedAt.getTime() - 60_000);
    expect(isSessionValid(tokenIat, { status: "ACTIVE", sessionInvalidatedAt: invalidatedBefore, passwordChangedAt: null })).toBe(true);
  });
  it("passwordChangedAt > 토큰 발급시각이면 무효(타 세션 무효화·D15)", () => {
    const changedAfter = new Date(tokenIssuedAt.getTime() + 60_000);
    expect(isSessionValid(tokenIat, { status: "ACTIVE", sessionInvalidatedAt: null, passwordChangedAt: changedAfter })).toBe(false);
  });
});

// ── 라우트 통합: 비활성화된 사용자의 기존 JWT는 auth()가 무효 세션(null)으로 해석 → 모든 인증 API 401 ──
const h = vi.hoisted(() => ({
  // task-07 세션 콜백이 무효 판정 시 user 없는 세션(또는 null)을 돌려줌을 흉내.
  auth: vi.fn(async () => null as unknown),
  requirePermission: vi.fn(async () => undefined),
  getPermissionSummary: vi.fn(async () => ({ keys: ["admin.users:update"] as string[], isOwner: false, isAdmin: false })),
  // finding E — 비활성화 액션이 setUserStatus로 라우팅됨을 추적(이 service가 sessionInvalidatedAt 갱신·세션무효화를 일으킴).
  setUserStatus: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...x: unknown[]) => unknown)(...a),
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...x: unknown[]) => unknown)(...a),
  ForbiddenError: class extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } },
}));
// setUserStatus만 추적 가능한 실제 모킹으로 노출하고, 그 외 service는 vi.fn으로 채운다(named export 명시).
vi.mock("@/modules/admin/users/services", () => ({
  setUserStatus: (...a: unknown[]) => (h.setUserStatus as (...x: unknown[]) => unknown)(...a),
  listUsersForView: vi.fn(async () => ({ rows: [], total: 0, pendingCount: 0 })),
  createUserByAdmin: vi.fn(async () => ({ id: "u-new" })),
  getUserForEdit: vi.fn(async () => null),
  updateUser: vi.fn(async () => undefined),
  approveUser: vi.fn(async () => undefined),
  rejectUser: vi.fn(async () => undefined),
  assignRoles: vi.fn(async () => undefined),
  upsertOverride: vi.fn(async () => ({ id: "ov1" })),
  removeOverride: vi.fn(async () => undefined),
  resetPassword: vi.fn(async () => ({ temporaryPassword: "tmp" })),
}));

import * as adminUsers from "@/app/api/admin/users/route";
import * as leaveRequests from "@/app/api/leave/requests/route";
import * as statusRoute from "@/app/api/admin/users/[id]/status/route";

// leave/requests는 requirePermission을 사용 — 모킹 필요.
vi.mock("@/modules/leave/services/requests", () => ({
  listMyRequests: vi.fn(async () => []),
  createLeaveRequest: vi.fn(async () => ({ id: "r1" })),
}));

const idCtx = { params: Promise.resolve({ id: "target1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue(null);
  h.requirePermission.mockResolvedValue(undefined);
  h.getPermissionSummary.mockResolvedValue({ keys: ["admin.users:update"], isOwner: false, isAdmin: false });
  h.setUserStatus.mockResolvedValue(undefined);
});

describe("비활성화된 사용자의 기존 JWT → 모든 인증 API 401(즉시 차단)", () => {
  it("GET /api/admin/users → 401", async () => {
    const res = await adminUsers.GET(new Request("http://x", { method: "GET" }));
    expect(res.status).toBe(401);
  });
  it("GET /api/leave/requests → 401", async () => {
    const res = await leaveRequests.GET(new Request("http://x", { method: "GET" }));
    expect(res.status).toBe(401);
  });
});

// finding E — 비활성화 액션(ACTIVE→DISABLED)은 PATCH가 아니라 status 전용 라우트로 들어와 setUserStatus로 라우팅된다.
// setUserStatus(S7)가 sessionInvalidatedAt=now를 기록(S6 setStatusTx)하므로, 위 isSessionValid 시나리오의
// "sessionInvalidatedAt > tokenIat → 무효" 가 실제로 발동하는 진입점이 이 라우트임을 통합으로 고정한다.
describe("finding E — ACTIVE→DISABLED는 status 라우트가 setUserStatus로 라우팅(세션무효화 진입점)", () => {
  it("POST /api/admin/users/[id]/status {status:DISABLED} → setUserStatus(ctx, id, 'DISABLED') 위임", async () => {
    h.auth.mockResolvedValue({ user: { id: "admin1", systemRole: "ADMIN" } });
    const res = await statusRoute.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ status: "DISABLED" }) }),
      idCtx,
    );
    expect(res.status).toBe(200);
    // setUserStatus 호출 = sessionInvalidatedAt=now 갱신·세션 무효화 경로 진입(D14·S6 setStatusTx).
    // 위 isSessionValid 시나리오의 "sessionInvalidatedAt > tokenIat → 무효"가 실제로 발동하는 진입점이 이 라우트다.
    expect(h.setUserStatus).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "admin1" }),
      "target1",
      "DISABLED",
    );
  });
  it("DISABLED→ACTIVE 재활성도 같은 status 라우트로 setUserStatus에 위임", async () => {
    h.auth.mockResolvedValue({ user: { id: "admin1", systemRole: "ADMIN" } });
    const res = await statusRoute.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ status: "ACTIVE" }) }),
      idCtx,
    );
    expect(res.status).toBe(200);
    expect(h.setUserStatus).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "admin1" }),
      "target1",
      "ACTIVE",
    );
  });
});

// 참고: 상태 토글을 PATCH /[id]로 보내면 zod strip로 빈 patch가 되어 400으로 거부됨(누수 방지)은
// task-05 id-route.test.ts가 검증한다 — finding E의 빈-PATCH 거부 단위는 거기에 두고 여기서 중복하지 않는다.
