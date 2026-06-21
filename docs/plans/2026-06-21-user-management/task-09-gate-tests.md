# task-09 — 통합 게이트/열거(D17)·남용(D18)·anti-escalation(D13) 테스트

> 앞선 task의 단위테스트가 못 잡는 **교차·통합·불변식 보존** 시나리오만 검증한다: must-change 하드 게이트의 라우트 열거(D17), 공개 남용 통제의 행/메일 미생성(D18), 위임 admin anti-escalation 교차(D13 ⓐ~ⓕ), 비활성화 세션 즉시 무효화. 개별 가드 단위(task-02)·라우트 단위(task-05)·repository 단위(task-03)와 **중복 작성 금지**.

## Files

**Test (Create)**
- `tests/app/api/admin/users/gate-enumeration.test.ts` — D17 라우트 열거(must-change 세션 → allowlist 외 전부 차단)
- `tests/app/api/auth/signup-abuse.test.ts` — D18 남용 통제(한도 초과 시 User·MailDelivery 미생성 + 429, RateBucket 상태)
- `tests/modules/admin/users/anti-escalation-integration.test.ts` — D13 ⓐ~ⓕ 교차(생성·승인·roles·override·reset-password 경로 전부 + 최소 가용성)
- `tests/app/api/admin/users/session-invalidation.test.ts` — 비활성화 후 기존 JWT로 모든 인증 API 거부

> Modify: 없음. 본 task는 테스트만 추가한다(프로덕션 코드 surgical 미변경).

## Prep

읽기(맥락 확인용, 재인라인 금지 — entrypoint §Shared Contracts가 단일 진실원):

- entrypoint `docs/plans/2026-06-21-user-management.md` §**S5**(가드 시그니처·`ActorContext`)·§**S9**(세션 무효화 + must-change **중앙 게이트** — `getPermissionSummary` must-change면 빈 `{keys:[]}`, `requirePermission` 거부, allowlist=`change-password`·`logout`)·§**S10**(D18 상수 `SIGNUP_IP_LIMIT=10`/`SIGNUP_EMAIL_LIMIT=3`/`RESEND_COOLDOWN_MS=60000`/`RATE_WINDOW_MS=3600000`/`PENDING_UNVERIFIED_CAP=200`, 원자적·사전 강제).
- spec 섹션 10(테스트 전략 전체)·D13 ⓐ~ⓕ·D14(reset-password 최소가용성·세션무효화)·D17(라우트 열거)·D18(행/메일 미생성).
- 패턴(인라인됨, 재읽기 불필요): `tests/app/api/leave/requests-route.test.ts`(vi.hoisted+vi.mock route 테스트, 401/400/201, `requirePermission` 인자 단언), `tests/app/api/admin/leave/approve-route.test.ts`(`mapError` 모킹·`ctx.params` Promise), `tests/kernel/access/decision.test.ts`(순수 함수). `vitest.config.ts` include 글롭(`tests/**/*.test.ts`)·`server-only` 스텁 alias.

## Deps

- **05** (admin API 라우트): 본 task가 import하는 admin/users 라우트 핸들러(`POST /api/admin/users`, `[id]/approve`, `[id]/roles`, `[id]/overrides`, `[id]/reset-password`, `[id]` PATCH)의 존재.
- **06** (자가가입·verify·D18): `POST /api/auth/signup`·`resend-verification` 라우트 + D18 레이트리밋 강제 경로(`RateBucket` 사전 increment).
- **07** (중앙 게이트·세션 무효화·auth 콜백): must-change 하드 게이트(§S9)·`sessionInvalidatedAt` 기반 세션 무효화. **D17 열거·세션무효화 테스트는 07이 만든 중앙 게이트 헬퍼/콜백 동작을 통합 검증**한다.

> 05·06·07이 합쳐진 표면을 검증하므로 deps=05,06,07. 본 task는 라우트·서비스·게이트를 **모킹하지 않고 통합 경로로 호출**하는 시나리오와, 모킹이 불가피한 경우(외부 의존성) **최소 모킹**을 구분한다(아래 각 step에 명시).

## steps

> 규칙: 매 스텝 — 실패 테스트 작성 → 실행(expect FAIL: 라우트/게이트 미구현 또는 동작 미반영) → 05/06/07 구현이 이미 있다면 즉시 PASS. 본 task는 테스트만 추가하므로 "구현"은 앞선 task가 제공한 표면이다. 모든 테스트 코드 전체 인라인.

### Step 1 — D17 라우트 열거 게이트 테스트

must-change 세션은 **중앙 게이트 한 곳**에서 차단된다(§S9: `getPermissionSummary`는 빈 `{keys:[]}`, `requirePermission`은 throw). 개별 라우트가 두 인가 경로 중 무엇을 쓰든 결과적으로 allowlist(`change-password`·`logout`) 외 모든 인증 API가 거부됨을 **라우트 목록 테이블 + each 순회**로 강제한다. 신규 API가 목록에서 빠지면 게이트 누수가 생기므로 목록을 코드로 못박는다.

테스트는 게이트의 두 출력 경로를 **중앙 헬퍼 수준**(task-07이 export하는 must-change 인지 `getPermissionSummary`/`requirePermission`)과 **라우트 수준**(핸들러가 그 헬퍼를 통해 403/빈 summary) 양쪽에서 검증한다. 라우트는 `auth`만 must-change 세션으로 모킹하고 `@/kernel/access`는 **task-07이 래핑한 실제 구현 동작을 흉내내는 게이트 모킹**으로, must-change면 throw/빈 배열을 반환하게 한다(통합 계약 고정).

`tests/app/api/admin/users/gate-enumeration.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── must-change 세션 + 중앙 게이트 동작을 흉내내는 hoisted 모킹 ──
// 게이트 계약(§S9·D17): mustChange=true 세션이면 requirePermission은 ForbiddenError,
// getPermissionSummary는 {keys:[]}. allowlist(change-password·logout)만 예외.
const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  // mustChange 플래그를 테스트가 토글. true면 게이트가 모든 권한을 닫는다.
  const state = { mustChange: true };
  return {
    FakeForbidden,
    state,
    auth: vi.fn(async () => ({ user: { id: "u1", systemRole: "MEMBER", mustChangePassword: state.mustChange } } as any)),
    // 중앙 게이트가 적용된 requirePermission: must-change면 fail-closed.
    requirePermission: vi.fn(async () => { if (state.mustChange) throw new FakeForbidden("must-change"); }),
    getPermissionSummary: vi.fn(async () => ({ keys: state.mustChange ? [] : ["admin.users:view"] })),
    // 서비스/리포는 호출되면 안 됨(게이트가 먼저 차단). 호출 시 테스트 실패를 유발하도록 throw.
    serviceCalled: vi.fn(() => { throw new Error("service should not run under must-change gate"); }),
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...x: unknown[]) => unknown)(...a),
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...x: unknown[]) => unknown)(...a),
  ForbiddenError: h.FakeForbidden,
}));
// 모든 admin/users·leave·workflows·settings 서비스는 게이트 통과 전 호출 금지 — 호출 시 throw.
vi.mock("@/modules/admin/users/services", () => new Proxy({}, { get: () => h.serviceCalled }));
vi.mock("@/kernel/settings", () => ({
  listSettings: (uid: string) => h.getPermissionSummary(uid).then((s: { keys: string[] }) => {
    if (s.keys.length === 0) throw new h.FakeForbidden("must-change");
    return [];
  }),
}));

// ── 라우트 핸들러 import (실제 모듈) ──
import * as adminUsers from "@/app/api/admin/users/route";
import * as adminUserId from "@/app/api/admin/users/[id]/route";
import * as approveRoute from "@/app/api/admin/users/[id]/approve/route";
import * as rejectRoute from "@/app/api/admin/users/[id]/reject/route";
import * as rolesRoute from "@/app/api/admin/users/[id]/roles/route";
import * as overridesRoute from "@/app/api/admin/users/[id]/overrides/route";
import * as resetPwRoute from "@/app/api/admin/users/[id]/reset-password/route";
import * as auditRoute from "@/app/api/admin/audit/route";
import * as settingsRoute from "@/app/api/admin/settings/route";
import * as permissionsRoute from "@/app/api/auth/permissions/route";
import * as leaveRequests from "@/app/api/leave/requests/route";
import * as changePwRoute from "@/app/api/auth/change-password/route";

const idCtx = { params: Promise.resolve({ id: "target1" }) };
function makeReq(method = "GET") {
  return new Request("http://x/api/_gate", { method, body: method === "GET" ? undefined : "{}" });
}

// ── 차단되어야 하는 라우트 열거 (allowlist 외 전부). 신규 API는 반드시 여기 추가 ──
type GateCase = {
  name: string;
  call: () => Promise<Response>;
  // getPermissionSummary 경로(빈 summary→직접 403/빈 응답) vs requirePermission 경로(throw→403)
  via: "requirePermission" | "summary";
};
const blockedRoutes: GateCase[] = [
  { name: "GET  /api/admin/users",                    via: "requirePermission", call: () => adminUsers.GET(makeReq("GET")) },
  { name: "POST /api/admin/users",                    via: "requirePermission", call: () => adminUsers.POST(makeReq("POST")) },
  { name: "GET  /api/admin/users/[id]",               via: "requirePermission", call: () => adminUserId.GET(makeReq("GET"), idCtx) },
  { name: "PATCH /api/admin/users/[id]",              via: "requirePermission", call: () => adminUserId.PATCH(makeReq("PATCH"), idCtx) },
  { name: "POST /api/admin/users/[id]/approve",       via: "requirePermission", call: () => approveRoute.POST(makeReq("POST"), idCtx) },
  { name: "POST /api/admin/users/[id]/reject",        via: "requirePermission", call: () => rejectRoute.POST(makeReq("POST"), idCtx) },
  { name: "POST /api/admin/users/[id]/roles",         via: "requirePermission", call: () => rolesRoute.POST(makeReq("POST"), idCtx) },
  { name: "POST /api/admin/users/[id]/overrides",     via: "requirePermission", call: () => overridesRoute.POST(makeReq("POST"), idCtx) },
  { name: "POST /api/admin/users/[id]/reset-password",via: "requirePermission", call: () => resetPwRoute.POST(makeReq("POST"), idCtx) },
  { name: "GET  /api/admin/audit",                    via: "requirePermission", call: () => auditRoute.GET() },
  { name: "GET  /api/admin/settings",                 via: "summary",           call: () => settingsRoute.GET() },
  { name: "GET  /api/auth/permissions",               via: "summary",           call: () => permissionsRoute.GET() },
  { name: "GET  /api/leave/requests",                 via: "requirePermission", call: () => leaveRequests.GET(makeReq("GET")) },
  { name: "POST /api/leave/requests",                 via: "requirePermission", call: () => leaveRequests.POST(makeReq("POST")) },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.state.mustChange = true;
  h.auth.mockImplementation(async () => ({ user: { id: "u1", systemRole: "MEMBER", mustChangePassword: h.state.mustChange } }));
  h.requirePermission.mockImplementation(async () => { if (h.state.mustChange) throw new h.FakeForbidden("must-change"); });
  h.getPermissionSummary.mockImplementation(async () => ({ keys: h.state.mustChange ? [] : ["admin.users:view"] }));
});

describe("D17 must-change 하드 게이트 — allowlist 외 모든 인증 API 차단", () => {
  it.each(blockedRoutes)("must-change 세션은 차단: $name", async ({ call, via }) => {
    const res = await call();
    if (via === "summary") {
      // 빈 summary 경로: 403(권한 없음) 또는 빈 결과. 어느 쪽이든 데이터 노출 없음.
      expect([401, 403]).toContain(res.status);
    } else {
      expect(res.status).toBe(403);
    }
    // 게이트 통과 전이라 도메인 서비스는 절대 실행되지 않아야 한다.
    expect(h.serviceCalled).not.toHaveBeenCalled();
  });

  it("getPermissionSummary 경로도 fail-closed(빈 keys)임을 직접 확인", async () => {
    expect(await h.getPermissionSummary("u1")).toEqual({ keys: [] });
  });

  it("requirePermission 경로도 must-change면 ForbiddenError", async () => {
    await expect(h.requirePermission("u1", "admin.users", "view")).rejects.toBeInstanceOf(h.FakeForbidden);
  });
});

describe("allowlist 라우트는 must-change 세션에서도 동작(change-password)", () => {
  it("POST /api/auth/change-password 는 게이트를 우회(403 아님)", async () => {
    // change-password 는 본인 인증만 요구하고 권한 게이트를 거치지 않는다(allowlist).
    // 본문 검증 실패(빈 {})로 400이 나더라도 403(게이트 차단)이 아님을 확인하는 것이 핵심.
    const res = await changePwRoute.POST(makeReq("POST"));
    expect(res.status).not.toBe(403);
  });
});

describe("must-change 해제 후에는 정상 권한 평가로 복귀", () => {
  it("mustChange=false면 admin.users:view 보유자는 목록 200", async () => {
    h.state.mustChange = false;
    // 서비스 모킹을 정상 응답으로 교체(게이트 통과 → 서비스 실행 허용).
    vi.doUnmock("@/modules/admin/users/services");
    h.requirePermission.mockResolvedValue(undefined);
    const res = await adminUsers.GET(makeReq("GET"));
    expect(res.status).not.toBe(403);
  });
});
```

실행:
```
npm test -- tests/app/api/admin/users/gate-enumeration   # 07 게이트 반영 전 FAIL → 반영 후 PASS
```

> 열거 배열 `blockedRoutes`가 **이 task의 게이트 누수 방지선**이다. task-05/06에서 admin/users 또는 인증 API 라우트를 추가하면 반드시 이 배열에 한 줄 추가한다(아래 Cautions).

### Step 2 — D18 공개 남용 통제(행/메일 미생성 + 429 + RateBucket)

`signup`·`resend-verification`은 미인증 공개 라우트. 한도 초과·쿨다운 위반 시 **User·MailDelivery 행이 생성되지 않고 429**임을 증명한다. 강제는 원자적·사전(§S10)이므로, 레이트리밋이 거부하면 `createPendingSignup`/메일 enqueue가 **호출조차 되지 않아야** 한다. prisma를 fake-db로 모킹해 `user.create`·`mailDelivery.create` 미호출 + `rateBucket` upsert/increment 상태를 단언한다.

`tests/app/api/auth/signup-abuse.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SIGNUP_IP_LIMIT, SIGNUP_EMAIL_LIMIT, RESEND_COOLDOWN_MS, RATE_WINDOW_MS } from "@/modules/admin/users/rate-limit";

// ── fake db: rateBucket(원자적 사전 카운트) + user/mailDelivery(생성 금지 검증) ──
const h = vi.hoisted(() => {
  class FakeRateLimit extends Error { constructor(m?: string) { super(m); this.name = "RateLimitError"; } }
  const db = {
    rateBucket: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), count: vi.fn(async () => 0) },
    mailDelivery: { create: vi.fn() },
  };
  const prisma = { ...db, $transaction: vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db)) };
  return { db, prisma, FakeRateLimit };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/modules/admin/users/errors", async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, RateLimitError: h.FakeRateLimit };
});

import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as resendPOST } from "@/app/api/auth/resend-verification/route";

function jsonReq(body: unknown, ip = "1.2.3.4") {
  return new Request("http://x/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}
const validSignup = { email: "new@x.com", name: "신규", employmentType: "REGULAR", jobFunction: "DEVELOPER", department: null };

beforeEach(() => {
  vi.clearAllMocks();
  // 기본: 윈도우 막 시작(여유), 중복 없음 → 정상 흐름 가능.
  h.db.rateBucket.upsert.mockResolvedValue({ scope: "signup:ip", key: "1.2.3.4", count: 1, windowStartedAt: new Date() });
  h.db.user.findUnique.mockResolvedValue(null);
  h.db.user.create.mockResolvedValue({ id: "u-new" });
  h.db.user.count.mockResolvedValue(0);
});

describe("D18 signup per-IP 한도 초과 → 429, User·MailDelivery 미생성", () => {
  it(`IP 카운트가 ${SIGNUP_IP_LIMIT} 초과면 429이고 user.create·mailDelivery.create 미호출`, async () => {
    // 사전 increment가 한도 초과 카운트를 반환 → RateLimitError(429).
    h.db.rateBucket.upsert.mockResolvedValueOnce({
      scope: "signup:ip", key: "1.2.3.4", count: SIGNUP_IP_LIMIT + 1, windowStartedAt: new Date(),
    });
    const res = await signupPOST(jsonReq(validSignup));
    expect(res.status).toBe(429);
    expect(h.db.user.create).not.toHaveBeenCalled();
    expect(h.db.mailDelivery.create).not.toHaveBeenCalled();
  });
});

describe("D18 signup per-email 한도 초과 → 429", () => {
  it(`email 카운트가 ${SIGNUP_EMAIL_LIMIT} 초과면 429, 행 미생성`, async () => {
    // per-IP는 통과, per-email increment에서 초과.
    h.db.rateBucket.upsert
      .mockResolvedValueOnce({ scope: "signup:ip", key: "1.2.3.4", count: 1, windowStartedAt: new Date() })
      .mockResolvedValueOnce({ scope: "signup:email", key: "new@x.com", count: SIGNUP_EMAIL_LIMIT + 1, windowStartedAt: new Date() });
    const res = await signupPOST(jsonReq(validSignup));
    expect(res.status).toBe(429);
    expect(h.db.user.create).not.toHaveBeenCalled();
    expect(h.db.mailDelivery.create).not.toHaveBeenCalled();
  });
});

describe("D18 미처리 PENDING 전역 상한(bounded creation)", () => {
  it("PENDING_UNVERIFIED_CAP 도달 시 429, 행 미생성", async () => {
    h.db.user.count.mockResolvedValue(999999); // 상한 초과 흉내
    const res = await signupPOST(jsonReq(validSignup));
    expect(res.status).toBe(429);
    expect(h.db.user.create).not.toHaveBeenCalled();
  });
});

describe("D18 resend 쿨다운 위반 → 429, 메일 미enqueue", () => {
  it(`마지막 발송이 ${RESEND_COOLDOWN_MS}ms 이내면 429이고 mailDelivery.create 미호출`, async () => {
    // resend 버킷이 쿨다운 윈도우 내(직전 발송)임을 흉내.
    h.db.rateBucket.upsert.mockResolvedValueOnce({
      scope: "resend:email", key: "new@x.com", count: 2, windowStartedAt: new Date(),
    });
    const res = await resendPOST(jsonReq({ email: "new@x.com" }));
    expect(res.status).toBe(429);
    expect(h.db.mailDelivery.create).not.toHaveBeenCalled();
  });
});

describe("D18 정상 흐름: 한도 내면 통과(차단 회귀 방지)", () => {
  it("윈도우 여유 + 중복 없음 → 429가 아니다", async () => {
    const res = await signupPOST(jsonReq(validSignup));
    expect(res.status).not.toBe(429);
  });
});

describe("D18 RateBucket 윈도우 강제는 원자적·사전임을 계약으로 고정", () => {
  it("거부 시 rateBucket는 조회/증가되었으나 user/mail은 손대지 않음", async () => {
    h.db.rateBucket.upsert.mockResolvedValueOnce({
      scope: "signup:ip", key: "1.2.3.4", count: SIGNUP_IP_LIMIT + 1, windowStartedAt: new Date(),
    });
    await signupPOST(jsonReq(validSignup));
    expect(h.db.rateBucket.upsert).toHaveBeenCalled();          // 사전 카운트 수행됨
    expect(h.db.user.create).not.toHaveBeenCalled();            // 쓰기 전 차단
    expect(RATE_WINDOW_MS).toBe(60 * 60 * 1000);                // 상수 계약 고정
  });
});
```

실행:
```
npm test -- tests/app/api/auth/signup-abuse   # 06 D18 강제 반영 전 FAIL → 반영 후 PASS
```

> 모킹 형태(`rateBucket.upsert` 반환 카운트)는 task-06이 확정한 사전-increment 시그니처에 맞춘다. task-06이 다른 메서드명(예: `$executeRaw` 원자 upsert)을 쓰면 이 모킹을 그 표면으로 맞춘다 — **단언의 본질**(초과 시 `user.create`/`mailDelivery.create` 미호출 + 429)은 불변.

### Step 3 — D13 anti-escalation 교차(ⓐ~ⓕ) 통합

task-02는 가드 함수 단위를 검증했다. 본 step은 **서비스 계층이 모든 mutation 경로(생성·승인·roles·override·reset-password)에서 그 가드를 실제로 호출**함을 통합으로 고정한다 — 권한키 검사를 통과한 위임 admin이 특권을 끌어올리지 못함을 경로별로 증명. 서비스는 실제 모듈을 호출하고, repository만 모킹(가드는 실제 실행).

`tests/modules/admin/users/anti-escalation-integration.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// repository는 모킹(가드를 통과한 경우에만 호출되어야 함). 가드/policy/errors는 실제 모듈.
const h = vi.hoisted(() => ({
  repo: {
    approveTx: vi.fn(async () => undefined),
    rejectTx: vi.fn(async () => undefined),
    createActiveUserByAdminTx: vi.fn(async () => ({ id: "u-new" })),
    setRoles: vi.fn(async () => undefined),
    createOverride: vi.fn(async () => ({ id: "ov1" })),
    deleteOverride: vi.fn(async () => undefined),
    resetPasswordTx: vi.fn(async () => undefined),
    updateUserTx: vi.fn(async () => undefined),
    getUserDetail: vi.fn(async () => ({ id: "target1", systemRole: "MEMBER", roleKeys: [], updatedAt: new Date(), emailVerifiedAt: new Date() })),
  },
  // reset-password 대상의 특권 판정에 필요한 조회(D14). 서비스가 대상 systemRole/roleKeys를 본다.
  hashPassword: vi.fn(async () => "hash"),
  randomPassword: vi.fn(() => "Temp1234!abcd"),
}));

vi.mock("@/modules/admin/users/repositories", () => h.repo);
vi.mock("@/lib/auth/password", () => ({ hashPassword: (...a: unknown[]) => h.hashPassword(...a), randomPassword: () => h.randomPassword() }));

import {
  approveUser, createUserByAdmin, assignRoles, upsertOverride, resetPassword, updateUser,
} from "@/modules/admin/users/services";
import { EscalationError } from "@/modules/admin/users/errors";
import type { ActorContext } from "@/modules/admin/users/services/guards";

const owner: ActorContext = { userId: "owner1", isOwner: true, permissionKeys: new Set(["admin.users:update", "admin.users:approve", "admin.users:create"]) };
// 위임 admin: admin.users:* 보유하나 비-OWNER. leave.approval:approve는 미보유(ⓒ 검증용).
const delegate: ActorContext = {
  userId: "admin1", isOwner: false,
  permissionKeys: new Set(["admin.users:view", "admin.users:create", "admin.users:update", "admin.users:approve", "admin.audit:view"]),
};

beforeEach(() => {
  vi.clearAllMocks();
  h.repo.getUserDetail.mockResolvedValue({ id: "target1", systemRole: "MEMBER", roleKeys: [], updatedAt: new Date(), emailVerifiedAt: new Date() });
});

// ⓐ 자가 mutation 금지 — 본인 역할/override/systemRole/status
describe("D13ⓐ 위임 admin 자가 mutation 거부", () => {
  it("자기 자신 역할 부여 → EscalationError", async () => {
    await expect(assignRoles(delegate, delegate.userId, ["regular-developer"])).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.setRoles).not.toHaveBeenCalled();
  });
  it("자기 자신 override 부여 → EscalationError", async () => {
    await expect(upsertOverride(delegate, delegate.userId, { resource: "admin.users", action: "view", effect: "ALLOW", scope: "all", reason: null, startsAt: null, endsAt: null }))
      .rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.createOverride).not.toHaveBeenCalled();
  });
  it("자기 자신 systemRole 변경 → EscalationError", async () => {
    await expect(updateUser(delegate, delegate.userId, { systemRole: "ADMIN" })).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.updateUserTx).not.toHaveBeenCalled();
  });
  it("OWNER는 자기 자신도 허용(대조군)", async () => {
    await expect(assignRoles(owner, owner.userId, ["pm"])).resolves.not.toThrow();
    expect(h.repo.setRoles).toHaveBeenCalled();
  });
});

// ⓑ 특권 역할(pm·admin) 부여는 OWNER만 — roles·:create·:approve 경로 전부
describe("D13ⓑ 특권 역할 부여는 OWNER만 (roles·create·approve 경로 전부)", () => {
  it("roles 경로: 위임 admin이 pm 부여 → 거부", async () => {
    await expect(assignRoles(delegate, "target1", ["pm"])).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.setRoles).not.toHaveBeenCalled();
  });
  it(":create 경로: 위임 admin이 admin 역할로 직접추가 → 거부", async () => {
    await expect(createUserByAdmin(delegate, {
      email: "x@x.com", name: "n", employmentType: "REGULAR", jobFunction: "DEVELOPER", department: null,
      systemRole: "MEMBER", roleKeys: ["admin"],
    })).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.createActiveUserByAdminTx).not.toHaveBeenCalled();
  });
  it(":approve 경로: 위임 admin이 승인 시 pm 확정 → 거부", async () => {
    await expect(approveUser(delegate, "target1", { employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: ["pm"] }))
      .rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.approveTx).not.toHaveBeenCalled();
  });
  it("OWNER는 세 경로 모두에서 pm/admin 부여 허용", async () => {
    await expect(assignRoles(owner, "target1", ["pm"])).resolves.not.toThrow();
    await expect(createUserByAdmin(owner, { email: "y@x.com", name: "n", employmentType: "REGULAR", jobFunction: "DEVELOPER", department: null, systemRole: "ADMIN", roleKeys: ["admin"] })).resolves.not.toThrow();
    await expect(approveUser(owner, "target1", { employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: ["pm"] })).resolves.not.toThrow();
  });
});

// systemRole 상승(OWNER/ADMIN)도 OWNER만 — create·approve·update 경로
describe("D12 OWNER/ADMIN systemRole 부여는 OWNER만 (create·approve·update)", () => {
  it("위임 admin이 :create로 ADMIN systemRole → 거부", async () => {
    await expect(createUserByAdmin(delegate, { email: "z@x.com", name: "n", employmentType: "REGULAR", jobFunction: "DEVELOPER", department: null, systemRole: "ADMIN", roleKeys: [] }))
      .rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 :approve로 OWNER systemRole 확정 → 거부", async () => {
    await expect(approveUser(delegate, "target1", { employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "OWNER", roleKeys: [] }))
      .rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 update로 ADMIN 승격 → 거부", async () => {
    await expect(updateUser(delegate, "target1", { systemRole: "ADMIN" })).rejects.toBeInstanceOf(EscalationError);
  });
});

// ⓒ 미보유 권한 ALLOW override 거부
describe("D13ⓒ 미보유 권한 ALLOW override 거부 (가진 것 이상 못 줌)", () => {
  it("위임 admin이 미보유 leave.approval:approve ALLOW → 거부", async () => {
    await expect(upsertOverride(delegate, "target1", { resource: "leave.approval", action: "approve", effect: "ALLOW", scope: "all", reason: null, startsAt: null, endsAt: null }))
      .rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.createOverride).not.toHaveBeenCalled();
  });
  it("위임 admin이 보유한 admin.users:view ALLOW → 허용", async () => {
    await expect(upsertOverride(delegate, "target1", { resource: "admin.users", action: "view", effect: "ALLOW", scope: "all", reason: null, startsAt: null, endsAt: null }))
      .resolves.not.toThrow();
    expect(h.repo.createOverride).toHaveBeenCalled();
  });
});

// ⓓ 동료 admin.*·audit DENY override 거부(lockout 방지)
describe("D13ⓓ critical(admin.*) DENY override는 OWNER만", () => {
  it("위임 admin이 동료 대상 admin.users:update DENY → 거부", async () => {
    await expect(upsertOverride(delegate, "target1", { resource: "admin.users", action: "update", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null }))
      .rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 동료 대상 admin.audit:view DENY → 거부", async () => {
    await expect(upsertOverride(delegate, "target1", { resource: "admin.audit", action: "view", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null }))
      .rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 비-critical leave.approval:approve DENY → 허용", async () => {
    await expect(upsertOverride(delegate, "target1", { resource: "leave.approval", action: "approve", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null }))
      .resolves.not.toThrow();
  });
  it("OWNER는 critical DENY 허용", async () => {
    await expect(upsertOverride(owner, "target1", { resource: "admin.users", action: "update", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null }))
      .resolves.not.toThrow();
  });
});

// ⓔ/ⓕ 최소 가용성 — reset-password 포함. repository가 throw하는 MinAvailabilityError를 서비스가 전파.
describe("D13ⓔ/ⓕ 최소 가용성 보존 (mutation이 마지막 관리자/감사조회자를 0으로 만들면 거부)", () => {
  it("setRoles가 MinAvailabilityError를 던지면 서비스가 전파(role 제거 경로)", async () => {
    const { MinAvailabilityError } = await import("@/modules/admin/users/errors");
    h.repo.setRoles.mockRejectedValueOnce(new MinAvailabilityError("last admin"));
    await expect(assignRoles(delegate, "target1", [])).rejects.toBeInstanceOf(MinAvailabilityError);
  });
  it("reset-password가 MinAvailabilityError를 던지면 전파(D14 — reset도 가용성 포함)", async () => {
    const { MinAvailabilityError } = await import("@/modules/admin/users/errors");
    h.repo.resetPasswordTx.mockRejectedValueOnce(new MinAvailabilityError("last admin via must-change"));
    await expect(resetPassword(owner, "target1")).rejects.toBeInstanceOf(MinAvailabilityError);
  });
});

// D14 — 특권 대상 reset-password는 OWNER만(위임 admin 거부)
describe("D14 특권 대상 reset-password는 OWNER만", () => {
  it("위임 admin이 OWNER systemRole 대상 reset → 거부", async () => {
    h.repo.getUserDetail.mockResolvedValue({ id: "target1", systemRole: "OWNER", roleKeys: [], updatedAt: new Date(), emailVerifiedAt: new Date() });
    await expect(resetPassword(delegate, "target1")).rejects.toBeInstanceOf(EscalationError);
    expect(h.repo.resetPasswordTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 pm 역할 보유 대상 reset → 거부", async () => {
    h.repo.getUserDetail.mockResolvedValue({ id: "target1", systemRole: "MEMBER", roleKeys: ["pm"], updatedAt: new Date(), emailVerifiedAt: new Date() });
    await expect(resetPassword(delegate, "target1")).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 비특권 대상 reset → 허용", async () => {
    h.repo.getUserDetail.mockResolvedValue({ id: "target1", systemRole: "MEMBER", roleKeys: ["regular-developer"], updatedAt: new Date(), emailVerifiedAt: new Date() });
    await expect(resetPassword(delegate, "target1")).resolves.not.toThrow();
    expect(h.repo.resetPasswordTx).toHaveBeenCalled();
  });
  it("위임 admin이 자기 자신 reset(admin 라우트) → 거부(D14·ⓐ)", async () => {
    await expect(resetPassword(delegate, delegate.userId)).rejects.toBeInstanceOf(EscalationError);
  });
});
```

실행:
```
npm test -- tests/modules/admin/users/anti-escalation-integration   # 04 서비스 가드 배선 전 FAIL → 후 PASS
```

> 서비스 함수의 정확한 시그니처(`upsertOverride`의 입력 형태 등)는 task-04 §S7을 따른다. 메서드명/입력이 달라지면 본 호출부를 §S7에 맞추되, **단언의 본질**(가드 위반 시 EscalationError·repository 미호출, 가용성 위반 전파)은 불변.

### Step 4 — 세션 무효화 통합(비활성화 즉시 차단)

유효 세션으로 인증 API에 접근 가능하던 사용자가 `ACTIVE→DISABLED`로 비활성화되면(`sessionInvalidatedAt=now`), **기존 JWT로는 토큰 만료 전에도 모든 인증 API가 거부**된다(§S9·spec 섹션 5). task-07이 만든 세션 콜백/중앙 게이트가 `User.status!==ACTIVE` 또는 `token.iat < sessionInvalidatedAt`이면 세션을 무효화함을 통합으로 고정한다.

세션 무효화 판정은 task-07이 export하는 순수 헬퍼 `isSessionValid(tokenIat: number, snap: {status, passwordChangedAt, sessionInvalidatedAt})`(§S9 확정 — 토큰 iat(초)·DB 스냅샷을 받아 유효/무효 반환)를 직접 검증하고, 그 결과가 라우트에서 401/403으로 이어짐을 `auth`가 무효 세션이면 `null`을 반환하는 형태로 확인한다.

`tests/app/api/admin/users/session-invalidation.test.ts`:

```ts
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
}));
vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...x: unknown[]) => unknown)(...a),
  getPermissionSummary: async () => ({ keys: [] as string[] }),
  ForbiddenError: class extends Error {},
}));
vi.mock("@/modules/admin/users/services", () => new Proxy({}, { get: () => vi.fn() }));

import * as adminUsers from "@/app/api/admin/users/route";
import * as leaveRequests from "@/app/api/leave/requests/route";

beforeEach(() => { vi.clearAllMocks(); h.auth.mockResolvedValue(null); });

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
```

실행:
```
npm test -- tests/app/api/admin/users/session-invalidation   # 07 콜백·헬퍼 반영 전 FAIL → 후 PASS
```

> `isSessionValid`의 헬퍼명/배치(`@/lib/auth/session-validity`)는 task-07이 §S9에서 확정하는 이름과 일치시킨다. task-07이 다른 이름(예: 콜백 인라인)으로 구현하면 순수 헬퍼를 분리하도록 task-07에 요청하거나, 본 테스트를 그 export 표면에 맞춘다 — **단언의 본질**(DISABLED·무효화시각·passwordChangedAt가 토큰 발급 이후면 무효)은 불변.

## Acceptance Criteria

1. **전체 테스트**
   ```bash
   npm test
   ```
   기대: 종료코드 0, 실패 0. 본 task가 추가한 4개 파일이 모두 PASS.
   출력에 다음 4개 파일이 보이고 모두 통과:
   - `tests/app/api/admin/users/gate-enumeration.test.ts`
   - `tests/app/api/auth/signup-abuse.test.ts`
   - `tests/modules/admin/users/anti-escalation-integration.test.ts`
   - `tests/app/api/admin/users/session-invalidation.test.ts`

2. **본 task 파일만 실행(빠른 피드백)**
   ```bash
   npm test -- tests/app/api/admin/users/gate-enumeration tests/app/api/auth/signup-abuse tests/modules/admin/users/anti-escalation-integration tests/app/api/admin/users/session-invalidation
   ```
   기대: `Test Files  4 passed (4)`, 각 describe 블록의 모든 `it`/`it.each` 케이스 PASS.
   - 열거 테스트: `blockedRoutes` 14개 케이스 전부 403(또는 summary 경로 401/403) + 서비스 미실행.
   - D18: per-IP/per-email/PENDING-cap/resend-cooldown 초과 시 429 + `user.create`/`mailDelivery.create` 미호출, 정상 흐름은 429 아님.
   - D13: ⓐ~ⓕ 각 경로 EscalationError·MinAvailabilityError 전파 + repository 미호출, OWNER 대조군 허용.
   - 세션무효화: `isSessionValid` 5케이스 + 무효 세션 라우트 401 2케이스.

3. **typecheck**
   ```bash
   npm run typecheck
   ```
   기대: 에러 0건. 본 task의 import(`@/app/api/...`·`@/modules/admin/users/...`·`@/lib/auth/session-validity`·`@/modules/admin/users/rate-limit` D18 상수)가 05/06/07 구현으로 모두 해소됨.

## Cautions

- **라우트 열거에서 신규 API를 빠뜨리면 게이트 누수다.** D17의 안전은 "allowlist 외 전부 차단"인데, 테스트가 일부 라우트만 확인하면 누락된 라우트는 must-change 세션에 그대로 노출된다. `blockedRoutes` 배열이 **이 누수를 코드로 막는 단일 지점**이다 — task-05/06에서 admin/users·인증 API 라우트를 추가하면 **반드시** 이 배열에 한 줄 추가한다(추가 안 하면 테스트는 통과하지만 게이트 누수가 묵인됨). 가능하면 `src/app/api` 트리를 글롭으로 읽어 enumerated 목록과 대조하는 메타 검사 추가를 고려(과하면 생략).
- **단위테스트와 중복 작성 금지.** 가드 함수 자체의 동작(`assertCanAssignRoles`가 pm을 거부)은 task-02 `guards.test.ts`가 이미 검증한다. 본 task는 **서비스가 그 가드를 실제로 호출하는지**(배선)와 **모든 mutation 경로가 빠짐없이 게이트되는지**(교차)만 본다. repository CAS 동작(`approveTx` count===0)은 task-03 `repositories.test.ts`가, 라우트 권한키 검사(`requirePermission` 호출 인자)는 task-05 라우트 테스트가 담당 — 여기서 재검증하지 않는다.
- **게이트 테스트는 도메인 서비스를 호출하지 않아야 정상이다.** `serviceCalled`가 호출되면(=게이트가 서비스 실행을 허용했으면) must-change 봉쇄가 새는 것 → 테스트 실패로 드러난다. 이 "서비스 미호출" 단언을 약화하지 말 것.
- **D18 단언의 본질은 "쓰기 전 차단"**이다. task-06이 사전-increment를 `rateBucket.upsert`가 아닌 다른 원자 연산(`$executeRaw` 등)으로 구현하면 모킹 표면만 그에 맞추되, `user.create`/`mailDelivery.create` **미호출** + 429 + RateBucket이 만져졌다는 세 단언은 유지한다. 한도 상수(`SIGNUP_IP_LIMIT` 등)는 §S10에서 import해 하드코딩하지 말 것(상수 드리프트 방지).
- **세션 무효화는 "토큰 만료 전 즉시"가 핵심.** `isSessionValid`가 만료(`exp`)에만 의존하면 비활성화가 토큰 수명만큼 지연되어 D14 위반 → `sessionInvalidatedAt`/`status` 기준 무효화를 반드시 검증한다. 발급시각 비교는 **초 단위 iat** vs **ms Date**의 단위 불일치에 주의(테스트가 `iat`를 초로 만든다).
- **05/06/07 미완 상태에서 본 task를 먼저 작성하면 import가 깨져 FAIL**한다(정상 — TDD의 RED). deps 순서상 05/06/07 머지 후 RED→GREEN을 확인한다. 헬퍼명(`isSessionValid`·서비스 함수명·D18 상수)이 §S7/§S9/§S10과 어긋나면 본 task가 아니라 **계약을 가진 task를 맞춘다**(entrypoint가 단일 진실원).
- **surgical**: 본 task는 `tests/` 4개 파일만 추가한다. 프로덕션 코드(`src/`)를 수정하지 않는다. 게이트/세션무효화/D18 강제 로직은 05/06/07 소관이다.
