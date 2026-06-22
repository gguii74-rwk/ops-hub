import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

// ── must-change 세션 + 중앙 게이트 동작을 흉내내는 hoisted 모킹 ──
// 게이트 계약(§S9·D17): mustChange=true 세션이면 requirePermission은 ForbiddenError(→403),
// getPermissionSummary는 {keys:[]}(fail-closed). access layer를 안 거치는 verifySession도 must-change면 null.
// allowlist(signup·verify-email·resend·nextauth·change-password·logout)만 예외.
const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  // mustChange 플래그를 테스트가 토글. true면 게이트가 모든 권한을 닫는다.
  const state = { mustChange: true };
  return {
    FakeForbidden,
    state,
    // must-change=true여도 유효한 세션 유지(§S9 must-change-USER 모델).
    // auth()는 null이 아니라 mustChangePassword=true인 user를 반환한다.
    // null 반환(auth()=null)은 비활성화/만료 세션 모델로, 다른 메커니즘(§S9 session 콜백 삭제).
    auth: vi.fn<() => Promise<{ user: { id: string; systemRole: string; mustChangePassword: boolean } }>>(async () => ({ user: { id: "u1", systemRole: "MEMBER", mustChangePassword: state.mustChange } })),
    // 중앙 게이트가 적용된 requirePermission: must-change면 ForbiddenError(→403).
    requirePermission: vi.fn<(...args: unknown[]) => Promise<void>>(async () => { if (state.mustChange) throw new FakeForbidden("must-change"); }),
    // getPermissionSummary: must-change면 빈 {keys:[]}(fail-closed). else 정상 권한 포함.
    getPermissionSummary: vi.fn<(...args: unknown[]) => Promise<{ keys: string[]; isOwner: boolean; isAdmin: boolean }>>(async () => ({ keys: state.mustChange ? [] as string[] : ["admin.users:view"], isOwner: false, isAdmin: false })),
    // verifySession(@/lib/auth/federation): must-change/비활성이면 null(§S9 — 공유 세션 해석 계층 차단).
    verifySession: vi.fn(async () => (state.mustChange ? null : { sub: "u1", email: "u1@x.com", groups: [] })),
    // 서비스/리포는 게이트가 먼저 차단해야 하므로 호출되면 안 됨. 호출 시 throw로 테스트를 실패시킨다.
    serviceCalled: vi.fn(() => { throw new Error("service should not run under must-change gate"); }),
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/lib/auth/federation", () => ({ verifySession: () => h.verifySession() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...x: unknown[]) => unknown)(...a),
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...x: unknown[]) => unknown)(...a),
  ForbiddenError: h.FakeForbidden,
}));
// settings의 listSettings는 내부적으로 requirePermission(admin.settings:view)을 호출하므로,
// must-change 상태에서 getPermissionSummary가 {keys:[]}를 반환하면 ForbiddenError를 던지도록 연결.
vi.mock("@/kernel/settings", () => ({
  listSettings: (uid: string) => (h.getPermissionSummary as (id: string) => Promise<{ keys: string[] }>)(uid).then((s) => {
    if (s.keys.length === 0) throw new h.FakeForbidden("must-change");
    return [];
  }),
}));
// 모든 admin/users 서비스: named export를 serviceCalled로 연결(게이트가 차단하면 절대 호출되지 않아야 함).
vi.mock("@/modules/admin/users/services", () => ({
  listUsersForView: (...a: unknown[]) => (h.serviceCalled as (...x: unknown[]) => unknown)(...a),
  createUserByAdmin: (...a: unknown[]) => (h.serviceCalled as (...x: unknown[]) => unknown)(...a),
  getUserForEdit: (...a: unknown[]) => (h.serviceCalled as (...x: unknown[]) => unknown)(...a),
  updateUser: (...a: unknown[]) => (h.serviceCalled as (...x: unknown[]) => unknown)(...a),
  approveUser: (...a: unknown[]) => (h.serviceCalled as (...x: unknown[]) => unknown)(...a),
  rejectUser: (...a: unknown[]) => (h.serviceCalled as (...x: unknown[]) => unknown)(...a),
  assignRoles: (...a: unknown[]) => (h.serviceCalled as (...x: unknown[]) => unknown)(...a),
  upsertOverride: (...a: unknown[]) => (h.serviceCalled as (...x: unknown[]) => unknown)(...a),
  removeOverride: (...a: unknown[]) => (h.serviceCalled as (...x: unknown[]) => unknown)(...a),
  setUserStatus: (...a: unknown[]) => (h.serviceCalled as (...x: unknown[]) => unknown)(...a),
  resetPassword: (...a: unknown[]) => (h.serviceCalled as (...x: unknown[]) => unknown)(...a),
}));
// leave services — 게이트 차단 검증용
vi.mock("@/modules/leave/services/requests", () => ({
  listMyRequests: (...a: unknown[]) => (h.serviceCalled as (...x: unknown[]) => unknown)(...a),
  createLeaveRequest: (...a: unknown[]) => (h.serviceCalled as (...x: unknown[]) => unknown)(...a),
}));

// ── 라우트 핸들러 import (실제 모듈) ──
import * as adminUsers from "@/app/api/admin/users/route";
import * as adminUserId from "@/app/api/admin/users/[id]/route";
import * as statusRoute from "@/app/api/admin/users/[id]/status/route";
import * as approveRoute from "@/app/api/admin/users/[id]/approve/route";
import * as rejectRoute from "@/app/api/admin/users/[id]/reject/route";
import * as rolesRoute from "@/app/api/admin/users/[id]/roles/route";
import * as overridesRoute from "@/app/api/admin/users/[id]/overrides/route";
import * as resetPwRoute from "@/app/api/admin/users/[id]/reset-password/route";
import * as auditRoute from "@/app/api/admin/audit/route";
import * as settingsRoute from "@/app/api/admin/settings/route";
import * as permissionsRoute from "@/app/api/auth/permissions/route";
import * as verifyRoute from "@/app/api/auth/verify/route";
import * as leaveRequests from "@/app/api/leave/requests/route";
import * as changePwRoute from "@/app/api/auth/change-password/route";

const idCtx = { params: Promise.resolve({ id: "target1" }) };
function makeReq(method = "GET", body?: unknown) {
  return new Request("http://x/api/_gate", {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
// 각 POST/PATCH 라우트의 body validation을 통과해 authorize(게이트)까지 도달하기 위한 최소 유효 본문.
// must-change 게이트 차단(403)이 body 검증 오류(400)보다 먼저 나오도록 body 검증을 통과시켜야 한다.
// body 검증이 먼저 실패하면 게이트 차단을 검증하지 못해 테스트 목적(D17)이 무의미해진다.
const bodies = {
  adminCreate: { email: "x@x.com", name: "테스트", password: "Temp1234!abcd", employmentType: "REGULAR", jobFunction: "DEVELOPER", department: null, systemRole: "MEMBER", roleKeys: [] },
  // updateUser/status/approve/roles는 낙관락 body 스키마라 updatedAt(ISO)을 포함해야 zod 통과 → 게이트(403)에 도달한다.
  // updatedAt이 없으면 body 검증 400이 게이트 차단보다 먼저 나와 D17 테스트 목적이 깨진다.
  updateUser: { name: "수정", updatedAt: "2026-06-01T00:00:00.000Z" },
  status: { status: "ACTIVE", updatedAt: "2026-06-01T00:00:00.000Z" },
  approve: { employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: [], updatedAt: "2026-06-01T00:00:00.000Z" },
  reject: { reason: "사유" },
  roles: { roleKeys: [], updatedAt: "2026-06-01T00:00:00.000Z" },
  override: { resource: "admin.users", action: "view", effect: "ALLOW", scope: "all", reason: null, startsAt: null, endsAt: null },
  resetPw: {}, // reset-password는 body 없이 바로 authorize
  leaveCreate: { leaveType: "ANNUAL", startDate: "2026-07-01", endDate: "2026-07-01" },
};

// ── 라우트 경로 정규화: src/app/api 기준 상대경로에서 /route.ts·동적 세그먼트를 정리 ──
function toApiPath(rel: string): string {
  const noFile = rel.replace(/[\\/]route\.ts$/, "");
  return "/api/" + noFile.split(sep).join("/");
}
// src/app/api 트리를 재귀 워크해 모든 route.ts 경로를 수집(파일시스템 진실원).
function enumerateApiRoutes(): string[] {
  const apiRoot = join(process.cwd(), "src", "app", "api");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name === "route.ts") out.push(toApiPath(relative(apiRoot, full)));
    }
  };
  walk(apiRoot);
  return out;
}

// ── ① public allowlist: 게이트 면제(미인증 공개·본인 전용·시스템 토큰 cron). 신규 공개 API는 여기 추가 ──
// §S9: must-change/세션무효 게이트에서 면제되는 경로. login/signup/verify-email/resend/nextauth(인증 자체)
// + change-password(본인 복구 경로) + leave/mail/drain(세션 아닌 LEAVE_MAIL_DRAIN_TOKEN 가드 cron).
// 이 목록에 없는 라우트는 반드시 exercised 또는 knownProtected에 있어야 한다.
const publicAllowlist = new Set<string>([
  "/api/auth/[...nextauth]",
  "/api/auth/signup",
  "/api/auth/verify-email",
  "/api/auth/resend-verification",
  "/api/auth/change-password",
  "/api/leave/mail/drain",
]);

// ── ② exercisedRoutes: 핸들러를 직접 호출해 차단을 증명하는 대표 라우트(진입 경로 3종 망라) ──
// 게이트가 loadUserContext/verifySession 단일 지점이라 대표 경로로 충분. user-mgmt 전부 + 각 경로 대표.
// via="requirePermission": must-change면 requirePermission이 ForbiddenError(→403).
// via="summary":           must-change면 getPermissionSummary가 {keys:[]} → authorize가 403(또는 401).
// via="verifySession":     access layer를 안 거치는 federation 경로 — verifySession()=null → 401.
type Gate = "requirePermission" | "summary" | "verifySession";
type GateCase = { path: string; call: () => Promise<Response>; via: Gate };
const exercisedRoutes: GateCase[] = [
  // GET 라우트: body 없이 authorize → ForbiddenError(→403).
  { path: "/api/admin/users",                     via: "requirePermission", call: () => adminUsers.GET(makeReq("GET")) },
  // POST/PATCH 라우트: body 검증을 통과해야 authorize(게이트)에 도달 — 유효 최소 본문 사용.
  { path: "/api/admin/users",                     via: "requirePermission", call: () => adminUsers.POST(makeReq("POST", bodies.adminCreate)) },
  { path: "/api/admin/users/[id]",                via: "requirePermission", call: () => adminUserId.GET(makeReq("GET"), idCtx) },
  { path: "/api/admin/users/[id]",                via: "requirePermission", call: () => adminUserId.PATCH(makeReq("PATCH", bodies.updateUser), idCtx) },
  { path: "/api/admin/users/[id]/status",         via: "requirePermission", call: () => statusRoute.POST(makeReq("POST", bodies.status), idCtx) },
  { path: "/api/admin/users/[id]/approve",        via: "requirePermission", call: () => approveRoute.POST(makeReq("POST", bodies.approve), idCtx) },
  { path: "/api/admin/users/[id]/reject",         via: "requirePermission", call: () => rejectRoute.POST(makeReq("POST", bodies.reject), idCtx) },
  { path: "/api/admin/users/[id]/roles",          via: "requirePermission", call: () => rolesRoute.POST(makeReq("POST", bodies.roles), idCtx) },
  { path: "/api/admin/users/[id]/overrides",      via: "requirePermission", call: () => overridesRoute.POST(makeReq("POST", bodies.override), idCtx) },
  { path: "/api/admin/users/[id]/overrides",      via: "requirePermission", call: () => overridesRoute.DELETE(new Request("http://x/api/_gate?overrideId=ov1", { method: "DELETE" }), idCtx) },
  // reset-password: body 없이 authorize 호출 — 이미 403 정상 동작.
  { path: "/api/admin/users/[id]/reset-password", via: "requirePermission", call: () => resetPwRoute.POST(makeReq("POST"), idCtx) },
  { path: "/api/admin/audit",                     via: "requirePermission", call: () => auditRoute.GET() },
  { path: "/api/admin/settings",                  via: "summary",           call: () => settingsRoute.GET() },
  { path: "/api/auth/permissions",                via: "summary",           call: () => permissionsRoute.GET() },
  // access layer를 안 거치는 federation 경로 — 수기 테이블이 빠뜨리던 라우트(finding #2).
  { path: "/api/auth/verify",                     via: "verifySession",     call: () => verifyRoute.GET() },
  { path: "/api/leave/requests",                  via: "requirePermission", call: () => leaveRequests.GET(makeReq("GET")) },
  { path: "/api/leave/requests",                  via: "requirePermission", call: () => leaveRequests.POST(makeReq("POST", bodies.leaveCreate)) },
];

// ── ③ knownProtected: 동일 중앙 게이트로 보호되지만 본 task가 호출하지는 않는 기존 라우트(분류만) ──
const knownProtected = new Set<string>([
  "/api/admin/settings/[key]",
  "/api/calendar/feed",
  "/api/calendar/refresh",
  "/api/workflows",
  "/api/workflows/[id]",
  "/api/workflows/[id]/cancel",
  "/api/workflows/[id]/mail/[deliveryId]/resolve",
  "/api/workflows/[id]/mail/[deliveryId]/retry",
  "/api/leave/requests/[id]",
  "/api/leave/requests/[id]/cancel",
  "/api/leave/summary",
  "/api/leave/dashboard",
  "/api/leave/calendar",
  "/api/admin/leave/allocations",
  "/api/admin/leave/allocations/[userId]/history",
  "/api/admin/leave/allocations/[userId]/[year]",
  "/api/admin/leave/allocations/[userId]/[year]/adjust",
  "/api/admin/leave/allocations/[userId]/[year]/recalculate",
  "/api/admin/leave/holidays/sync",
  "/api/admin/leave/approvals",
  "/api/admin/leave/requests",
  "/api/admin/leave/requests/[id]",
  "/api/admin/leave/requests/[id]/approve",
  "/api/admin/leave/requests/[id]/reject",
  "/api/admin/leave/users",
  "/api/admin/leave/status",
  "/api/admin/leave/status/export",
  // navigation CMS (task-10) — requirePermission(admin.navigation, view|configure) 중앙 게이트
  "/api/admin/navigation",
  "/api/admin/navigation/[id]",
  "/api/admin/navigation/[id]/reparent",
  "/api/admin/navigation/reorder",
  "/api/admin/navigation/roles",
]);

beforeEach(() => {
  vi.clearAllMocks();
  h.state.mustChange = true;
  // must-change-USER 모델: 유효 세션이지만 mustChangePassword=true. auth()=null이 아님.
  h.auth.mockImplementation(async () => ({ user: { id: "u1", systemRole: "MEMBER", mustChangePassword: h.state.mustChange } }));
  // must-change면 requirePermission이 ForbiddenError(→403) — 중앙 게이트 계약.
  h.requirePermission.mockImplementation(async () => { if (h.state.mustChange) throw new h.FakeForbidden("must-change"); });
  // must-change면 빈 {keys:[]}(fail-closed). authorize()가 이를 보고 ForbiddenError(→403)를 던진다.
  h.getPermissionSummary.mockImplementation(async () => ({ keys: h.state.mustChange ? [] as string[] : ["admin.users:view"], isOwner: false, isAdmin: false }));
  h.verifySession.mockImplementation(async () => (h.state.mustChange ? null : { sub: "u1", email: "u1@x.com", groups: [] }));
});

// ── no-orphan 메타 검사: 파일시스템의 모든 라우트가 세 분류에 등록되어 있어야 한다 ──
describe("D17 라우트 enumeration — 신규 API가 어느 분류에도 없으면 실패(게이트 누수 방지)", () => {
  const exercisedPaths = new Set(exercisedRoutes.map((r) => r.path));
  const classified = new Set<string>([...publicAllowlist, ...exercisedPaths, ...knownProtected]);
  it("src/app/api/**/route.ts 전부가 allowlist·exercised·knownProtected 중 하나로 분류됨", () => {
    const all = enumerateApiRoutes();
    expect(all.length).toBeGreaterThan(0); // enumeration이 비어 통과를 위장하지 않게
    const unregistered = all.filter((p) => !classified.has(p));
    // 신규 라우트가 어느 분류에도 없으면 여기서 경로를 노출하며 실패한다.
    // → 공개면 publicAllowlist, 검증 강화면 exercisedRoutes, 그 외 보호면 knownProtected에 등록할 것.
    expect(unregistered, `미분류 라우트(게이트 미검증): ${unregistered.join(", ")}`).toEqual([]);
  });
  it("public allowlist는 보호 분류와 겹치지 않는다(공개=차단 모순 방지)", () => {
    const protectedAll = new Set<string>([...exercisedPaths, ...knownProtected]);
    const overlap = [...publicAllowlist].filter((p) => protectedAll.has(p));
    expect(overlap, `allowlist·보호 중복: ${overlap.join(", ")}`).toEqual([]);
  });
  it("/api/auth/verify 가 exercised(차단 증명 대상)에 포함된다(finding #2 회귀 방지)", () => {
    expect(exercisedPaths.has("/api/auth/verify")).toBe(true);
  });
});

describe("D17 must-change 하드 게이트 — must-change USER 세션으로 모든 보호 API 차단(§S9)", () => {
  it.each(exercisedRoutes)("must-change 세션은 차단: [$via] $path", async ({ call, via }) => {
    const res = await call();
    if (via === "requirePermission") {
      // requirePermission 경로: must-change면 ForbiddenError → 403.
      expect(res.status).toBe(403);
    } else if (via === "summary") {
      // getPermissionSummary 경로: must-change면 {keys:[]} → authorize가 ForbiddenError(→403)
      // 또는 라우트에 따라 401. 일부 라우트(/api/auth/permissions)는 200+빈keys로
      // fail-closed 응답을 반환할 수 있음 — 어느 쪽이든 데이터 노출 없이 차단됨.
      // (브리프 §S9 "403 또는 빈 결과. 어느 쪽이든 데이터 노출 없음")
      if (res.status === 200) {
        // 200이라면 권한이 실제로 비어 있어야 한다(노출 0 단언).
        const body = await res.json() as { keys?: unknown[]; isOwner?: unknown; isAdmin?: unknown };
        expect(body.keys).toEqual([]);
        if ("isOwner" in body) expect(body.isOwner).toBe(false);
        if ("isAdmin" in body) expect(body.isAdmin).toBe(false);
      } else {
        expect([401, 403]).toContain(res.status);
      }
    } else {
      // verifySession 경로: verifySession()=null → 핸들러가 401(헤더·그룹 미발급).
      expect(res.status).toBe(401);
    }
    // 게이트 통과 전이라 도메인 서비스는 절대 실행되지 않아야 한다.
    expect(h.serviceCalled).not.toHaveBeenCalled();
  });

  it("getPermissionSummary 경로도 fail-closed(빈 keys)임을 직접 확인", async () => {
    const summary = await h.getPermissionSummary("u1");
    expect(summary.keys).toEqual([]);
  });

  it("requirePermission 경로도 must-change면 ForbiddenError", async () => {
    await expect(h.requirePermission("u1", "admin.users", "view")).rejects.toBeInstanceOf(h.FakeForbidden);
  });

  it("verifySession 경로도 must-change/비활성이면 null(federation 헤더·그룹 미발급)", async () => {
    expect(await h.verifySession()).toBeNull();
  });
});

describe("allowlist 라우트는 must-change USER 세션에서도 게이트를 우회(change-password 도달성 양성 검증)", () => {
  it("POST /api/auth/change-password 는 must-change 세션에서 게이트(403/401)를 통과해 자체 로직에 도달", async () => {
    // must-change-USER 세션: auth()는 유효한 user를 반환한다(mustChangePassword=true).
    // change-password는 publicAllowlist에 속해 requirePermission/authorize를 거치지 않는다.
    // 따라서 유효 세션으로 라우트에 진입 후 body 검증(빈 {} → newPassword 미제공)에서 400이 나야 한다.
    // 403이 나면 게이트가 이 복구 경로를 차단하는 것 — 버그(must-change 사용자가 비번 변경 불가).
    // 401이 나면 auth()가 null을 반환하는 다른 모델로 바뀐 것 — 이 테스트의 전제 붕괴.
    const res = await changePwRoute.POST(makeReq("POST", {}));
    // 빈 {} 본문 → changePasswordSchema 실패(newPassword 미제공) → 400.
    // 400은 라우트 자체 body 검증에 도달했음을 의미 — 게이트(403/401) 차단이 아님.
    expect(res.status).toBe(400);
    // change-password는 권한 게이트(requirePermission/authorize)를 경유하지 않는다.
    expect(h.requirePermission).not.toHaveBeenCalled();
    // 도메인 서비스(changePasswordTx)에는 도달하기 전에 body 검증으로 반환되므로 serviceCalled 미호출.
    expect(h.serviceCalled).not.toHaveBeenCalled();
  });
});

describe("must-change 해제 후에는 정상 권한 평가로 복귀(대조군)", () => {
  it("mustChange=false면 authorize가 통과하고 서비스에 도달(게이트 해제 확인)", async () => {
    h.state.mustChange = false;
    // must-change 해제: serviceCalled를 정상 응답으로 교체(게이트 통과 → 서비스 실행 허용).
    h.serviceCalled.mockResolvedValueOnce({ rows: [], total: 0, pendingCount: 0 } as never);
    const res = await adminUsers.GET(makeReq("GET"));
    // 403(게이트 차단)이 아닌 다른 응답.
    expect(res.status).not.toBe(403);
    // 서비스가 호출됨(게이트 통과).
    expect(h.serviceCalled).toHaveBeenCalled();
  });
});
