# task-10 — API 라우트: 게이트·낙관락·에러 매핑

**목적:** 관리 화면이 호출하는 라우트 핸들러를 구현한다. 읽기는 `authorizeView`(D9), 변경은 서비스가 configure 게이트. 낙관락 body(SC-7), 도메인 에러→HTTP 매핑(SC-9).

## Files

- **Create:** `src/app/api/admin/navigation/_shared.ts`
- **Create:** `src/app/api/admin/navigation/route.ts`(GET tree, POST create)
- **Create:** `src/app/api/admin/navigation/[id]/route.ts`(PATCH update, DELETE)
- **Create:** `src/app/api/admin/navigation/[id]/reparent/route.ts`(POST)
- **Create:** `src/app/api/admin/navigation/reorder/route.ts`(POST)
- **Create:** `src/app/api/admin/navigation/roles/route.ts`(GET role preview)
- **Create (test):** `tests/app/api/admin/navigation/route.test.ts`

## Prep

- 스펙 §7·§8·결정 D9/D10/D13.
- 엔트리포인트 §Shared Contracts **SC-3**(권한키)·**SC-7**(낙관락 body)·**SC-9**(에러 매핑).
- 기존 출처: `src/app/api/admin/users/route.ts`·`[id]/route.ts`·`_shared.ts`(라우트 패턴·`authorize`·`mapError`·empty-patch 거부·async params), `src/kernel/optimistic.ts`(`parseExpectedUpdatedAt`).

## Deps

task-09(services).

## Cautions

- **읽기 라우트만 `authorizeView`(view).** 변경 라우트는 서비스가 configure를 게이트하므로 라우트에서 별도 authorize 불필요 — 단 `session.user.id`는 추출해 서비스에 넘긴다. `requirePermission` throw → `mapError`로 403.
- **OWNER는 키 멤버십과 무관 통과**(users `authorize` 동형 — seed 의존 lockout 방지). `authorizeView`에 그대로 반영.
- **empty patch 거부**(users 동형): `updatedAt`만 있고 실제 patch 0개면 400(상태 안 바뀐 채 200 반환 방지).
- **알 수 없는 에러는 `mapError`가 재throw**(500을 삼키지 않음). NavigationConflict→409, NavigationValidation→400, Forbidden→403만 매핑.
- async params: `{ params }: { params: Promise<{ id: string }> }` + `const { id } = await params;`(Next 16).

## Step 1 — 실패 테스트

`tests/app/api/admin/navigation/route.test.ts` 생성:

```ts
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
  it("정상 200 + updatedAt 적용", async () => {
    const body = JSON.stringify({ updatedAt: AT });
    const res = await DELETE(new Request("http://x", { method: "DELETE", body }), params("p1"));
    expect(res.status).toBe(200);
    expect(h.deleteNavigationItem).toHaveBeenCalledWith("admin1", "p1", new Date(AT));
  });
  it("updatedAt 누락 400", async () => {
    const res = await DELETE(new Request("http://x", { method: "DELETE", body: "{}" }), params("p1"));
    expect(res.status).toBe(400);
  });
});
```

실행: `npm test -- api/admin/navigation` → **FAIL**.

## Step 2 — _shared.ts

`src/app/api/admin/navigation/_shared.ts`:

```ts
import { NextResponse } from "next/server";
import { ForbiddenError, getPermissionSummary } from "@/kernel/access";
import { NavigationConflictError, NavigationValidationError } from "@/modules/admin/navigation/errors";

// 읽기 게이트(view). OWNER는 키 멤버십과 무관 통과(users authorize 동형 — seed 의존 lockout 방지).
export async function authorizeView(userId: string): Promise<void> {
  const summary = await getPermissionSummary(userId);
  if (summary.isOwner) return;
  if (!summary.keys.includes("admin.navigation:view")) {
    throw new ForbiddenError("admin.navigation:view 권한이 없습니다.");
  }
}

// 도메인 에러 → HTTP. 알 수 없는 에러는 재throw(500 삼키지 않음 — users _shared 동형).
export function mapError(error: unknown): NextResponse {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof NavigationValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof NavigationConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  throw error;
}
```

## Step 3 — route.ts (GET tree, POST create)

`src/app/api/admin/navigation/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listNavigationTree, createNavigationItem } from "@/modules/admin/navigation/services";
import { createNavSchema } from "@/modules/admin/navigation/validations";
import { authorizeView, mapError } from "./_shared";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    await authorizeView(session.user.id);
    const tree = await listNavigationTree();
    return NextResponse.json(tree, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return mapError(e);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = createNavSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    const created = await createNavigationItem(session.user.id, parsed.data);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (e) {
    return mapError(e);
  }
}
```

## Step 4 — [id]/route.ts (PATCH, DELETE)

`src/app/api/admin/navigation/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateNavigationItem, deleteNavigationItem } from "@/modules/admin/navigation/services";
import { updateNavBodySchema, deleteNavBodySchema } from "@/modules/admin/navigation/validations";
import { parseExpectedUpdatedAt } from "@/kernel/optimistic";
import { mapError } from "../_shared";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = updateNavBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const { updatedAt, ...patch } = parsed.data;
  // updatedAt은 낙관락 메타 — patch 카운트에서 제외. 실제 patch 0개면 거부(상태 안 바뀐 200 방지).
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "empty patch" }, { status: 400 });
  try {
    await updateNavigationItem(session.user.id, id, patch, parseExpectedUpdatedAt(updatedAt));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = deleteNavBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await deleteNavigationItem(session.user.id, id, parseExpectedUpdatedAt(parsed.data.updatedAt));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
```

## Step 5 — [id]/reparent/route.ts · reorder/route.ts · roles/route.ts

`src/app/api/admin/navigation/[id]/reparent/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reparentNavigationItem } from "@/modules/admin/navigation/services";
import { reparentNavBodySchema } from "@/modules/admin/navigation/validations";
import { parseExpectedUpdatedAt } from "@/kernel/optimistic";
import { mapError } from "../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = reparentNavBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await reparentNavigationItem(session.user.id, id, parsed.data.newParentId, parseExpectedUpdatedAt(parsed.data.updatedAt));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
```

`src/app/api/admin/navigation/reorder/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reorderNavigationItems } from "@/modules/admin/navigation/services";
import { reorderNavSchema } from "@/modules/admin/navigation/validations";
import { mapError } from "../_shared";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = reorderNavSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await reorderNavigationItems(session.user.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
```

`src/app/api/admin/navigation/roles/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { previewRoles } from "@/modules/admin/navigation/services";
import { authorizeView, mapError } from "../_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const permissionId = new URL(req.url).searchParams.get("permissionId");
  if (!permissionId) return NextResponse.json({ error: "permissionId required" }, { status: 400 });
  try {
    await authorizeView(session.user.id);
    const roles = await previewRoles(permissionId);
    return NextResponse.json({ roles }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return mapError(e);
  }
}
```

실행: `npm test -- api/admin/navigation` → **PASS**.

## Acceptance Criteria

- `npm test -- api/admin/navigation` → 전부 PASS(401/403/400/409/201/200 매핑·empty-patch 거부·OWNER bypass).
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 errors.
- `npm run build` → 라우트 컴파일 성공.
