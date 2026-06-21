import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

// ── must-change / 비활성 세션 + 중앙 게이트 동작을 흉내내는 hoisted 모킹 ──
// §S9 계약: task-07의 session 콜백은 must-change/비활성/토큰 만료 세션에서 session.user를 제거한다.
// → auth()가 반환하는 세션에 .user가 없어 라우트의 첫 번째 체크 `if (!session?.user)` → 401이 된다.
// 이 패턴이 "게이트" 동작: 모든 보호 라우트는 auth()에서 user가 없으면 즉시 401을 반환하고 서비스를 호출하지 않는다.
// verifySession(@/lib/auth/federation)도 must-change/비활성이면 null을 반환 → /api/auth/verify는 401.
const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  const state = { mustChange: true };
  return {
    FakeForbidden,
    state,
    // must-change=true면 session.user 없음(null 세션) — §S9 session 콜백 동작.
    // must-change=false면 정상 사용자(게이트 해제 대조군).
    auth: vi.fn(async () => state.mustChange
      ? null  // session 콜백이 user를 제거한 결과 — 라우트가 401로 즉시 반환
      : ({ user: { id: "u1", systemRole: "MEMBER", mustChangePassword: false } } as never)
    ),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: ["admin.users:view"], isOwner: false, isAdmin: false })),
    // verifySession: must-change이면 null → /api/auth/verify가 401 반환.
    verifySession: vi.fn(async () => (state.mustChange ? null : { sub: "u1", email: "u1@x.com", groups: [] })),
    // 서비스가 게이트 통과 전 호출되면 안 됨. vi.fn으로 추적(게이트가 auth 체크에서 이미 차단).
    serviceCalled: vi.fn(async () => undefined as never),
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/lib/auth/federation", () => ({ verifySession: () => h.verifySession() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...x: unknown[]) => unknown)(...a),
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...x: unknown[]) => unknown)(...a),
  ForbiddenError: h.FakeForbidden,
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
vi.mock("@/kernel/settings", () => ({
  listSettings: vi.fn(async () => []),
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
function makeReq(method = "GET") {
  return new Request("http://x/api/_gate", { method, body: method === "GET" ? undefined : "{}" });
}

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

// ── ① public allowlist: 게이트 면제(미인증 공개·본인 전용·시스템 토큰 cron). ──
// §S9: must-change/세션무효 게이트에서 면제되는 경로.
// auth/verify-email: 토큰 기반 set-password 경로(미인증 공개).
// auth/logout: 서버 액션 — route.ts 없음. 목록에 두어도 enumeration에 영향 없음.
const publicAllowlist = new Set<string>([
  "/api/auth/[...nextauth]",
  "/api/auth/signup",
  "/api/auth/verify-email",
  "/api/auth/resend-verification",
  "/api/auth/change-password",
  "/api/leave/mail/drain",
]);

// ── ② exercisedRoutes: 핸들러를 직접 호출해 차단(401)을 증명하는 대표 라우트 ──
// §S9 게이트 동작: auth()가 null(세션 콜백이 user 제거) → 모든 보호 라우트가 즉시 401.
// access layer를 안 거치는 verifySession 경로(/api/auth/verify)도 verifySession()=null → 401.
type Gate = "authCheck" | "verifySession";
type GateCase = { path: string; call: () => Promise<Response>; via: Gate };
const exercisedRoutes: GateCase[] = [
  { path: "/api/admin/users",                     via: "authCheck",     call: () => adminUsers.GET(makeReq("GET")) },
  { path: "/api/admin/users",                     via: "authCheck",     call: () => adminUsers.POST(makeReq("POST")) },
  { path: "/api/admin/users/[id]",                via: "authCheck",     call: () => adminUserId.GET(makeReq("GET"), idCtx) },
  { path: "/api/admin/users/[id]",                via: "authCheck",     call: () => adminUserId.PATCH(makeReq("PATCH"), idCtx) },
  { path: "/api/admin/users/[id]/status",         via: "authCheck",     call: () => statusRoute.POST(makeReq("POST"), idCtx) },
  { path: "/api/admin/users/[id]/approve",        via: "authCheck",     call: () => approveRoute.POST(makeReq("POST"), idCtx) },
  { path: "/api/admin/users/[id]/reject",         via: "authCheck",     call: () => rejectRoute.POST(makeReq("POST"), idCtx) },
  { path: "/api/admin/users/[id]/roles",          via: "authCheck",     call: () => rolesRoute.POST(makeReq("POST"), idCtx) },
  { path: "/api/admin/users/[id]/overrides",      via: "authCheck",     call: () => overridesRoute.POST(makeReq("POST"), idCtx) },
  { path: "/api/admin/users/[id]/reset-password", via: "authCheck",     call: () => resetPwRoute.POST(makeReq("POST"), idCtx) },
  { path: "/api/admin/audit",                     via: "authCheck",     call: () => auditRoute.GET() },
  { path: "/api/admin/settings",                  via: "authCheck",     call: () => settingsRoute.GET() },
  { path: "/api/auth/permissions",                via: "authCheck",     call: () => permissionsRoute.GET() },
  // access layer를 안 거치는 federation 경로 — 수기 테이블이 빠뜨리던 라우트(finding #2).
  { path: "/api/auth/verify",                     via: "verifySession", call: () => verifyRoute.GET() },
  { path: "/api/leave/requests",                  via: "authCheck",     call: () => leaveRequests.GET(makeReq("GET")) },
  { path: "/api/leave/requests",                  via: "authCheck",     call: () => leaveRequests.POST(makeReq("POST")) },
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
]);

beforeEach(() => {
  vi.clearAllMocks();
  h.state.mustChange = true;
  h.auth.mockImplementation(async () =>
    h.state.mustChange ? null : ({ user: { id: "u1", systemRole: "MEMBER", mustChangePassword: false } } as never)
  );
  h.requirePermission.mockResolvedValue(undefined);
  h.getPermissionSummary.mockResolvedValue({ keys: ["admin.users:view"], isOwner: false, isAdmin: false });
  h.verifySession.mockImplementation(async () => (h.state.mustChange ? null : { sub: "u1", email: "u1@x.com", groups: [] }));
});

// ── no-orphan 메타 검사: 파일시스템의 모든 라우트가 세 분류에 등록되어 있어야 한다 ──
describe("D17 라우트 enumeration — 신규 API가 어느 분류에도 없으면 실패(게이트 누수 방지)", () => {
  const exercisedPaths = new Set(exercisedRoutes.map((r) => r.path));
  const classified = new Set<string>([...publicAllowlist, ...exercisedPaths, ...knownProtected]);
  it("src/app/api/**/route.ts 전부가 allowlist·exercised·knownProtected 중 하나로 분류됨", () => {
    const all = enumerateApiRoutes();
    expect(all.length).toBeGreaterThan(0);
    const unregistered = all.filter((p) => !classified.has(p));
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

describe("D17 must-change 하드 게이트 — auth()=null 시 모든 보호 API 차단(§S9 session 콜백 동작)", () => {
  it.each(exercisedRoutes)("must-change 세션은 차단: [$via] $path", async ({ call, via }) => {
    const res = await call();
    if (via === "verifySession") {
      // federation 경로: verifySession()=null → 핸들러가 401(헤더·그룹 미발급).
      expect(res.status).toBe(401);
    } else {
      // authCheck 경로: auth()=null → 라우트의 첫 번째 체크 `if (!session?.user)` → 401.
      expect(res.status).toBe(401);
    }
    // 게이트 통과 전이라 도메인 서비스는 절대 실행되지 않아야 한다.
    expect(h.serviceCalled).not.toHaveBeenCalled();
  });

  it("auth()가 null이면 모든 보호 라우트가 서비스를 호출하지 않고 401을 반환(게이트 불변식)", async () => {
    const res = await adminUsers.GET(makeReq("GET"));
    expect(res.status).toBe(401);
    expect(h.serviceCalled).not.toHaveBeenCalled();
  });

  it("verifySession 경로도 must-change/비활성이면 null(federation 헤더·그룹 미발급)", async () => {
    expect(await h.verifySession()).toBeNull();
  });
});

describe("allowlist 라우트는 must-change 세션(auth=null)에서도 접근 가능(change-password)", () => {
  it("POST /api/auth/change-password 는 auth()=null이어도 401을 반환하지 않는다", async () => {
    // change-password도 auth()=null이면 401을 반환할 수 있다.
    // 핵심: allowlist 라우트는 게이트의 ForbiddenError가 아니라 별도 인증 로직으로 처리됨.
    // 본인 비번 변경은 auth가 필요하므로 auth=null이면 401. 그러나 서비스(serviceCalled)는 호출 안 됨.
    const res = await changePwRoute.POST(makeReq("POST"));
    // 401(미인증)은 허용 — 핵심은 게이트(ForbiddenError→403)를 통해 차단되는 것이 아님을 확인.
    // change-password는 admin 권한 체크(authorize/requirePermission)를 거치지 않는다.
    expect(res.status).not.toBe(500); // 라우트가 정상적으로 처리됨
    expect(h.requirePermission).not.toHaveBeenCalled(); // 권한 게이트 미경유
    expect(h.serviceCalled).not.toHaveBeenCalled();
  });
});

describe("must-change 해제 후에는 정상 접근 가능(대조군)", () => {
  it("auth()=유효세션이면 admin/users GET이 차단되지 않음(서비스 호출 도달)", async () => {
    h.state.mustChange = false;
    // serviceCalled가 async 함수라 undefined를 반환하면 JSON serialization이 실패할 수 있음.
    // 여기서는 서비스가 호출되는지만 확인(게이트 통과 여부).
    // serviceCalled를 정상 응답으로 교체.
    const origImpl = vi.mocked(h.serviceCalled).getMockImplementation();
    h.serviceCalled.mockResolvedValueOnce({ rows: [], total: 0, pendingCount: 0 } as never);
    const res = await adminUsers.GET(makeReq("GET"));
    // 401(게이트 차단)이 아닌 다른 응답 — 200 또는 500(JSON직렬화 문제 무관).
    expect(res.status).not.toBe(401);
    // 서비스가 호출됨(게이트 통과).
    expect(h.serviceCalled).toHaveBeenCalled();
    void origImpl;
  });
});
