# Task 05 — admin API 라우트

**Purpose:** spec 섹션 8 표의 admin/users 라우트(`/api/admin/users` 목록·생성, `[id]` 조회·편집, `approve`/`reject`/`roles`/`overrides`/`reset-password`)를 추가한다. 각 라우트는 leave 라우트 패턴(`auth()`→401, `req.json()`→400, zod safeParse→400, `requirePermission`→403)을 따르고, 세션+`getPermissionSummary`로 **ActorContext**(S5)를 구성해 **service(S7)만 호출**한다. 도메인 에러는 공유 `mapError`(S4)로 HTTP 코드에 매핑한다. 라우트는 권한키 검사 + service 위임만 하고, D12/D13 anti-escalation은 service가 별개로 강제한다(라우트에 가드 로직 넣지 않음).

## Files
- Create: `src/app/api/admin/users/_shared.ts` — S4 `mapError` + `buildActorCtx`(ActorContext 빌더)
- Create: `src/app/api/admin/users/route.ts` — `GET`(목록·`admin.users:view`), `POST`(직접추가·`admin.users:create`)
- Create: `src/app/api/admin/users/[id]/route.ts` — `GET`(`:view`), `PATCH`(`:update`)
- Create: `src/app/api/admin/users/[id]/approve/route.ts` — `POST`(`admin.users:approve`)
- Create: `src/app/api/admin/users/[id]/reject/route.ts` — `POST`(`admin.users:approve`)
- Create: `src/app/api/admin/users/[id]/roles/route.ts` — `POST`(`:update`)
- Create: `src/app/api/admin/users/[id]/overrides/route.ts` — `POST`/`DELETE`(`:update`)
- Create: `src/app/api/admin/users/[id]/reset-password/route.ts` — `POST`(`:update`)
- Create (Test): `tests/app/api/admin/users/route.test.ts` — `GET`/`POST /api/admin/users`
- Create (Test): `tests/app/api/admin/users/id-route.test.ts` — `GET`/`PATCH /api/admin/users/[id]`
- Create (Test): `tests/app/api/admin/users/approve-reject-route.test.ts` — `approve`/`reject`
- Create (Test): `tests/app/api/admin/users/mutations-route.test.ts` — `roles`/`overrides`/`reset-password`

## Prep
- entrypoint §Shared Contracts: **S4**(도메인 에러 종류 + 라우트 매핑 표 — `ForbiddenError`/`EscalationError`→403, `UserConflictError`/`MinAvailabilityError`→409, `UserValidationError`/`TokenError`→400, `RateLimitError`→429), **S5**(`ActorContext` = `{userId, isOwner, permissionKeys}`), **S7**(이 task가 호출할 service 함수 시그니처 전부 + validation 스키마 목록).
- spec 섹션 8(API 계약 표 — 라우트별 메서드·권한키), 섹션 8 마지막 문단(권한키 통과해도 service가 D12/D13 별도 강제), 섹션 6·9(에러 처리 — 400/403/409).
- 패턴 참조(인라인됨, 재읽기 불필요):
  - leave `route.ts`(`src/app/api/leave/requests/route.ts`) — `auth()`→401 / `req.json()` try-catch→400 / `safeParse`→400 / `requirePermission`→403 / `mapError`.
  - leave 동적 라우트(`src/app/api/admin/leave/requests/[id]/approve/route.ts`) — `{ params }: { params: Promise<{ id: string }> }`, `await params`.
  - leave cancel 라우트(`src/app/api/leave/requests/[id]/cancel/route.ts`) — `getPermissionSummary` + `buildLeaveCtx(session.user, summary.keys)`로 ctx 구성 후 service 호출(이 task의 `buildActorCtx`와 동형).
  - leave `_shared.ts`(`src/app/api/leave/_shared.ts`) — `mapError` 구조 + `buildLeaveCtx`(ActorContext 빌더 동형).
  - `requirePermission`/`getPermissionSummary`/`ForbiddenError`(`src/kernel/access/index.ts`).
- 테스트 모킹은 `tests/app/api/admin/leave/approve-route.test.ts`(`vi.hoisted` + `vi.mock`, 동적 라우트 `ctx = { params: Promise.resolve({ id }) }`)와 `tests/app/api/leave/requests-route.test.ts`(GET/POST 미인증·잘못된 입력·정상 위임)의 패턴을 따른다.

## Deps
- 04 (`src/modules/admin/users/services/index.ts`의 S7 service 함수 + `src/modules/admin/users/validations/index.ts`의 zod 스키마, `src/modules/admin/users/errors.ts`의 S4 에러 클래스). task-04는 task-02(guards·errors)·task-03(repository)에 의존하므로 이 라우트 task는 그 위에 얹는다.

## Steps

### 1. 실패 테스트 — `_shared.ts`(mapError·buildActorCtx) + `/api/admin/users`(GET·POST)

`tests/app/api/admin/users/route.test.ts` — leave requests-route.test.ts의 `vi.hoisted`+`vi.mock` 패턴. service·access·auth를 모킹하고, 라우트가 ① 미인증 401 ② 잘못된 입력 400 ③ 권한키 검사 ④ ActorContext를 service에 위임하는지 단언한다. `_shared.ts`의 `mapError`(S4 전체 매핑)와 `buildActorCtx`도 같은 파일에서 직접 단위 검증한다.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "admin1", systemRole: "ADMIN" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: ["admin.users:view", "admin.users:create"] })),
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
  h.getPermissionSummary.mockResolvedValue({ keys: ["admin.users:view", "admin.users:create"] });
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

describe("_shared buildActorCtx (S5)", () => {
  it("OWNER면 isOwner=true, permissionKeys=Set(keys)", () => {
    const ctx = buildActorCtx({ id: "o1", systemRole: "OWNER" } as any, ["admin.users:view"]);
    expect(ctx).toEqual({ userId: "o1", isOwner: true, permissionKeys: new Set(["admin.users:view"]) });
  });
  it("비-OWNER면 isOwner=false", () => {
    const ctx = buildActorCtx({ id: "a1", systemRole: "ADMIN" } as any, []);
    expect(ctx.isOwner).toBe(false);
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
  it("권한 없으면 403(requirePermission throw → mapError)", async () => {
    h.requirePermission.mockRejectedValueOnce(new h.FakeForbidden("denied"));
    const res = await GET(new Request("http://x/api/admin/users"));
    expect(res.status).toBe(403);
    expect(h.listUsersForView).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/users (직접추가)", () => {
  const valid = JSON.stringify({
    email: "new@x.com", name: "신규", temporaryPassword: "tempPass1234",
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
```

```
npm test -- tests/app/api/admin/users/route   # expect FAIL (라우트·_shared 미존재)
```

### 2. 최소 구현 — `_shared.ts`(mapError + buildActorCtx)

`src/app/api/admin/users/_shared.ts` (S4 매핑 + S5 ActorContext 빌더). leave `_shared.ts`의 `mapError`/`buildLeaveCtx` 구조를 그대로 따른다. `ActorContext` 타입은 service(S5)가 export하므로 재정의하지 않고 import한다.

```ts
import { NextResponse } from "next/server";
import { ForbiddenError } from "@/kernel/access";
import type { SessionUser } from "@/lib/auth/types";
import type { ActorContext } from "@/modules/admin/users/services/guards";
import {
  EscalationError, MinAvailabilityError, RateLimitError, TokenError,
  UserConflictError, UserValidationError,
} from "@/modules/admin/users/errors";

// S4 도메인 에러 → HTTP 매핑. 알 수 없는 에러는 재throw해 500을 삼키지 않는다(leave _shared.ts와 동형).
export function mapError(error: unknown): NextResponse {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof EscalationError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof UserConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof MinAvailabilityError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof UserValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof TokenError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
  throw error;
}

// S5 ActorContext 빌더. 세션 + getPermissionSummary().keys로 구성. isOwner는 systemRole로 판정.
// 권위(finding #1·§S9): u.systemRole은 task-07 session 콜백이 매 요청 DB 현재값으로 fresh 재구성한 권위값이다
// (stale JWT 아님). anti-escalation(D12/D13)이 isOwner 위에 서므로, 강등된 前 OWNER가 토큰 만료 전 가드를
// 우회하지 못하려면 systemRole의 권위원이 DB여야 한다. 콜백이 DB 재구성을 하지 않으면 이 가드는 무력화된다.
export function buildActorCtx(u: SessionUser, keys: string[]): ActorContext {
  return { userId: u.id, isOwner: u.systemRole === "OWNER", permissionKeys: new Set(keys) };
}
```

> `ActorContext`는 S5에서 task-02 `services/guards.ts`가 정의·export한다. 라우트/`_shared`는 그 타입만 import하고, 절대 재정의하지 않는다(SSOT).

### 3. 최소 구현 — `/api/admin/users` route (GET 목록 · POST 직접추가)

`src/app/api/admin/users/route.ts`. GET은 쿼리(status/employmentType/jobFunction/q/page/pageSize) 파싱 후 `listUsersForView(ctx, filter)`. POST는 `adminCreateSchema` 검증 후 `createUserByAdmin(ctx, input)`. 두 메서드 모두 `requirePermission`로 권한키 검사 → `getPermissionSummary`로 ctx 구성 → service 위임. status 쿼리는 `UserStatus` enum 값만 허용(아니면 400).

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { listUsersForView, createUserByAdmin } from "@/modules/admin/users/services";
import { adminCreateSchema } from "@/modules/admin/users/validations";
import { buildActorCtx, mapError } from "./_shared";

const STATUSES = ["PENDING", "INVITED", "ACTIVE", "DISABLED", "REJECTED"] as const;
type Status = (typeof STATUSES)[number];
function isStatus(v: string): v is Status {
  return (STATUSES as readonly string[]).includes(v);
}
function parsePositiveInt(v: string | null, fallback: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status");
  if (status && !isStatus(status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
  const filter = {
    status: status ? (status as Status) : undefined,
    employmentType: sp.get("employmentType") ?? undefined,
    jobFunction: sp.get("jobFunction") ?? undefined,
    q: sp.get("q") ?? undefined,
    page: parsePositiveInt(sp.get("page"), 1),
    pageSize: parsePositiveInt(sp.get("pageSize"), 20),
  };
  try {
    await requirePermission(session.user.id, "admin.users", "view");
    const summary = await getPermissionSummary(session.user.id);
    const result = await listUsersForView(buildActorCtx(session.user, summary.keys), filter);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = adminCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "admin.users", "create");
    const summary = await getPermissionSummary(session.user.id);
    const created = await createUserByAdmin(buildActorCtx(session.user, summary.keys), parsed.data);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    return mapError(error);
  }
}
```

```
npm test -- tests/app/api/admin/users/route   # expect PASS
```

### 4. 실패 테스트 — `/api/admin/users/[id]` (GET 상세 · PATCH 편집)

`tests/app/api/admin/users/id-route.test.ts`. 동적 라우트는 `ctx = { params: Promise.resolve({ id }) }`(leave approve-route.test.ts 패턴). GET=`:view`+`getUserForEdit`, PATCH=`:update`+`updateUser`. 상세 미존재(service가 `null`)면 404.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "admin1", systemRole: "ADMIN" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: ["admin.users:view", "admin.users:update"] })),
    getUserForEdit: vi.fn(async () => ({ id: "u1", email: "u1@x.com" })),
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
  h.getPermissionSummary.mockResolvedValue({ keys: ["admin.users:view", "admin.users:update"] });
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
```

```
npm test -- tests/app/api/admin/users/id-route   # expect FAIL
```

### 5. 최소 구현 — `/api/admin/users/[id]` route (GET · PATCH)

`src/app/api/admin/users/[id]/route.ts`. GET은 `getUserForEdit(ctx, id)`가 `null`이면 404, 아니면 상세 반환. PATCH는 `updateUserSchema` 검증 후 `updateUser(ctx, id, patch)`.

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { getUserForEdit, updateUser } from "@/modules/admin/users/services";
import { updateUserSchema } from "@/modules/admin/users/validations";
import { buildActorCtx, mapError } from "../_shared";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    await requirePermission(session.user.id, "admin.users", "view");
    const summary = await getPermissionSummary(session.user.id);
    const detail = await getUserForEdit(buildActorCtx(session.user, summary.keys), id);
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "admin.users", "update");
    const summary = await getPermissionSummary(session.user.id);
    await updateUser(buildActorCtx(session.user, summary.keys), id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
```

```
npm test -- tests/app/api/admin/users/id-route   # expect PASS
```

### 6. 실패 테스트 — `approve` / `reject`

`tests/app/api/admin/users/approve-reject-route.test.ts`. 둘 다 `admin.users:approve` 권한키. approve=`approveSchema`(employmentType/jobFunction/systemRole/roleKeys), reject=`rejectSchema`(reason). service가 `UserConflictError`(CAS 충돌·미검증 승인)면 409.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "admin1", systemRole: "ADMIN" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: ["admin.users:approve"] })),
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
  h.getPermissionSummary.mockResolvedValue({ keys: ["admin.users:approve"] });
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
```

```
npm test -- tests/app/api/admin/users/approve-reject-route   # expect FAIL
```

### 7. 최소 구현 — `approve` / `reject` route

`src/app/api/admin/users/[id]/approve/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { approveUser } from "@/modules/admin/users/services";
import { approveSchema } from "@/modules/admin/users/validations";
import { buildActorCtx, mapError } from "../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = approveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "admin.users", "approve");
    const summary = await getPermissionSummary(session.user.id);
    await approveUser(buildActorCtx(session.user, summary.keys), id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
```

`src/app/api/admin/users/[id]/reject/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { rejectUser } from "@/modules/admin/users/services";
import { rejectSchema } from "@/modules/admin/users/validations";
import { buildActorCtx, mapError } from "../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "admin.users", "approve");
    const summary = await getPermissionSummary(session.user.id);
    await rejectUser(buildActorCtx(session.user, summary.keys), id, parsed.data.reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
```

```
npm test -- tests/app/api/admin/users/approve-reject-route   # expect PASS
```

### 8. 실패 테스트 — `roles` / `overrides` / `reset-password`

`tests/app/api/admin/users/mutations-route.test.ts`. 세 라우트 모두 `admin.users:update` 권한키. roles=`rolesSchema`(roleKeys[]), overrides POST=`overrideSchema`/DELETE=overrideId 쿼리, reset-password=본문 없음. service가 `MinAvailabilityError`(D13ⓔ/D14)면 409, `EscalationError`면 403.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "admin1", systemRole: "ADMIN" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: ["admin.users:update"] })),
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
  h.getPermissionSummary.mockResolvedValue({ keys: ["admin.users:update"] });
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
```

```
npm test -- tests/app/api/admin/users/mutations-route   # expect FAIL
```

### 9. 최소 구현 — `roles` / `overrides` / `reset-password` route

`src/app/api/admin/users/[id]/roles/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { assignRoles } from "@/modules/admin/users/services";
import { rolesSchema } from "@/modules/admin/users/validations";
import { buildActorCtx, mapError } from "../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = rolesSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "admin.users", "update");
    const summary = await getPermissionSummary(session.user.id);
    await assignRoles(buildActorCtx(session.user, summary.keys), id, parsed.data.roleKeys);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
```

`src/app/api/admin/users/[id]/overrides/route.ts` (POST 생성 / DELETE 제거 — `overrideId`는 쿼리스트링):

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { upsertOverride, removeOverride } from "@/modules/admin/users/services";
import { overrideSchema } from "@/modules/admin/users/validations";
import { buildActorCtx, mapError } from "../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "admin.users", "update");
    const summary = await getPermissionSummary(session.user.id);
    const created = await upsertOverride(buildActorCtx(session.user, summary.keys), id, parsed.data);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    return mapError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const overrideId = new URL(req.url).searchParams.get("overrideId");
  if (!overrideId) return NextResponse.json({ error: "overrideId required" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "admin.users", "update");
    const summary = await getPermissionSummary(session.user.id);
    await removeOverride(buildActorCtx(session.user, summary.keys), id, overrideId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
```

`src/app/api/admin/users/[id]/reset-password/route.ts` (본문 없음 — service가 임시비번 생성·반환):

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { resetPassword } from "@/modules/admin/users/services";
import { buildActorCtx, mapError } from "../../_shared";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    await requirePermission(session.user.id, "admin.users", "update");
    const summary = await getPermissionSummary(session.user.id);
    const result = await resetPassword(buildActorCtx(session.user, summary.keys), id);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
```

> `resetPassword`의 반환은 S7 service 계약을 따른다(임시비번을 관리자에게 한 번 노출 — D4/D14 "관리자 전달" 모델). service가 `{ temporaryPassword }` 외 형태로 반환하면 그 객체를 그대로 직렬화한다. 라우트에서 비번을 직접 생성하지 않는다(service 책임).

```
npm test -- tests/app/api/admin/users/mutations-route   # expect PASS
```

### 10. 커밋

```
git add src/app/api/admin/users tests/app/api/admin/users
git commit -m "feat(user-mgmt): admin/users API 라우트 — auth/zod/권한키 게이트 + ActorContext service 위임(S4·S5·S7)"
```

## Acceptance Criteria

```
npm run typecheck   # 0 errors (라우트가 S7 service 시그니처·S5 ActorContext 타입과 일치)
npm test -- tests/app/api/admin/users   # 4개 파일 전부 PASS (route·id-route·approve-reject·mutations)
npm run lint        # 0 errors (boundaries: app→{kernel,lib,module} 허용이라 service/_shared import 통과)
```

기대:
- `npm test -- tests/app/api/admin/users` → `Test Files  4 passed`, 전 테스트 green.
- 각 라우트가 ① 미인증 401 ② invalid json/zod 400 ③ 섹션 8 표의 정확한 권한키(`view`/`create`/`update`/`approve`)로 `requirePermission` 호출 ④ `buildActorCtx`로 만든 ActorContext를 첫 인자로 service에 위임 ⑤ 도메인 에러를 `mapError`로 S4 코드(403/409/400/429)에 매핑.
- `npm run lint`: no-unknown/element-types 위반 없음.

## Cautions

- **권한키 검사만으로 D12/D13을 막지 마라.** 라우트는 섹션 8 표의 permission 키(`:view`/`:create`/`:update`/`:approve`)만 검사하고, anti-escalation(D12 systemRole 상승·D13ⓐ~ⓔ 자가 mutation·특권 역할·override 한도·최소 가용성·D14 특권 대상 reset)은 **service 계층이 별개로 강제**한다. 라우트에 `isOwner` 분기·특권 역할 검사·가용성 카운트 같은 가드 로직을 절대 넣지 마라 — `EscalationError`/`MinAvailabilityError`를 service에서 받아 `mapError`로 변환만 한다. (그래서 `:create`/`:approve`도 역할 부여 경로이므로 동일 가드 service를 통과한다.)
- **repository 직접 호출 금지.** 라우트는 오직 S7 service(`listUsersForView`/`createUserByAdmin`/`getUserForEdit`/`updateUser`/`approveUser`/`rejectUser`/`assignRoles`/`upsertOverride`/`removeOverride`/`resetPassword`)만 import한다. repository(task-03)·guards(task-02)를 라우트에서 부르면 가드 우회 경로가 생긴다.
- **ActorContext는 항상 라우트에서 구성한다.** `requirePermission` 통과 후 `getPermissionSummary(uid).keys`로 `permissionKeys`를 채운다. `isOwner`는 세션 `systemRole === "OWNER"`로 판정한다. service가 `permissionKeys`로 ALLOW override 한도(D13ⓒ)를 검증하므로 summary를 빼먹으면 가드가 오작동한다.
- **Caution(권위·finding #1) — `isOwner`는 DB 권위에 근거해야 한다.** `buildActorCtx`가 신뢰하는 `session.user.systemRole`은 **stale JWT가 아니라 task-07의 session 콜백이 매 요청 DB 현재값으로 fresh 재구성한 권위값**이다(§S9). anti-escalation(D12/D13) 전체가 이 `isOwner` 위에 서 있으므로, 만약 systemRole을 발급 시점 JWT 스냅샷에서 그대로 가져오면 **강등된 前 OWNER가 토큰 만료 전까지 OWNER 권한으로 가드를 우회**한다. 따라서 라우트/`_shared`는 코드 변경 없이 `session.user.systemRole`을 그대로 신뢰하되, **그 값의 권위원이 DB(task-07 콜백)** 라는 전제에 의존한다 — task-07 §S9가 session 콜백을 DB fresh 재구성으로 구현하지 않으면 이 가드가 무력화된다(task-09 `session-authority.test.ts`가 이 전제를 회귀 검증). `_shared.ts`의 `buildActorCtx`에도 이 전제를 한 줄 주석으로 남긴다.
- **`mapError`는 알 수 없는 에러를 재throw한다**(leave `_shared.ts`와 동일). 500을 200/빈 응답으로 삼키지 마라 — 매핑 안 된 예외는 Next 런타임이 500으로 처리하게 둔다.
- **`ActorContext` 타입은 재정의 금지.** S5의 `services/guards.ts`가 SSOT. `_shared.ts`는 `import type { ActorContext }`만 한다.
- **status 쿼리·overrideId 같은 비-zod 입력 검증은 라우트에서.** 잘못된 enum/누락 시 service 호출 전에 400. 단 도메인 검증(역할 키 존재·권한 키 존재 등)은 service/repository 책임이므로 라우트에서 선검사하지 마라.
- **동적 라우트 시그니처**는 Next 16 규약 `{ params }: { params: Promise<{ id: string }> }` + `await params`(leave approve 라우트와 동일). 동기 `params` 사용 금지(typecheck 실패).
- **DELETE overrides의 `overrideId`는 쿼리스트링**(`?overrideId=`)으로 받는다(본문 없는 DELETE 관례). zod 스키마(`overrideSchema`)는 POST 본문 검증용이며 DELETE엔 적용하지 않는다.
