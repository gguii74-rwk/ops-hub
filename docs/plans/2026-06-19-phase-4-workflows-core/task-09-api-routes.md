# Task 09 — API 라우트 + zod 검증 (6개)

목록·상세·생성·취소·메일 재시도·SENDING 해소 6개 라우트와 zod 입력 검증을 만든다. 권한은 UI와 동일 키, 에러는 공통 헬퍼로 매핑(Forbidden→403, Conflict→409).

## Files

- Create: `src/modules/workflows/validations/index.ts`
- Create: `src/app/api/workflows/_shared.ts` (에러 매핑·ctx 빌더 — 라우트 전용 헬퍼)
- Create: `src/app/api/workflows/route.ts` (GET 목록, POST 생성)
- Create: `src/app/api/workflows/[id]/route.ts` (GET 상세)
- Create: `src/app/api/workflows/[id]/cancel/route.ts` (POST 취소)
- Create: `src/app/api/workflows/[id]/mail/[deliveryId]/retry/route.ts` (POST 재시도)
- Create: `src/app/api/workflows/[id]/mail/[deliveryId]/resolve/route.ts` (POST 해소)
- Create (test): `tests/app/api/workflows/routes.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts **SC-6**(service), **SC-8**(ctx 구성·에러 매핑), **SC-9**(라우트 표).
- 라우트 패턴: `src/app/api/calendar/feed/route.ts`(auth→401, ForbiddenError→403), `src/app/api/admin/settings/[key]/route.ts`(동적 `params: Promise<…>`, `await params`).
- 세션: `session.user.systemRole`로 `isOwner`/`isAdmin` 도출(SC-8).

## Deps

- Task 04(lifecycle), Task 06(mail service), Task 07(tasks read service).

## Step 1 — 실패 테스트

생성: `tests/app/api/workflows/routes.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  let session: any = { user: { id: "u1", systemRole: "MEMBER", email: "u1@x", name: "U1", employmentType: "REGULAR", jobFunction: "PM" } };
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    getSession: () => session,
    setSession: (v: any) => { session = v; },
    FakeForbidden,
    getPermissionSummary: vi.fn(async () => ({ keys: [] as string[] })),
    getTaskList: vi.fn(async () => [] as any[]),
    getTaskDetailView: vi.fn(async () => null as any),
    createTask: vi.fn(async () => ({ id: "new" })),
    cancelTask: vi.fn(async () => undefined),
    retryDelivery: vi.fn(async () => ({ id: "d1", status: "SENT" })),
    resolveDelivery: vi.fn(async () => ({ id: "d1", status: "FAILED" })),
  };
});

vi.mock("@/lib/auth", () => ({ auth: async () => h.getSession() }));
vi.mock("@/kernel/access", () => ({ ForbiddenError: h.FakeForbidden, getPermissionSummary: (u: string) => h.getPermissionSummary(u) }));
vi.mock("@/modules/workflows/services/tasks", () => ({ getTaskList: (...a: any) => h.getTaskList(...a), getTaskDetailView: (...a: any) => h.getTaskDetailView(...a) }));
vi.mock("@/modules/workflows/services/lifecycle", () => ({ createTask: (...a: any) => h.createTask(...a), cancelTask: (...a: any) => h.cancelTask(...a) }));
vi.mock("@/modules/workflows/services/mail", () => ({ retryDelivery: (...a: any) => h.retryDelivery(...a), resolveDelivery: (...a: any) => h.resolveDelivery(...a) }));

import { ConflictError } from "@/modules/workflows/types";
import { GET as listGET, POST as createPOST } from "@/app/api/workflows/route";
import { GET as detailGET } from "@/app/api/workflows/[id]/route";
import { POST as cancelPOST } from "@/app/api/workflows/[id]/cancel/route";
import { POST as retryPOST } from "@/app/api/workflows/[id]/mail/[deliveryId]/retry/route";
import { POST as resolvePOST } from "@/app/api/workflows/[id]/mail/[deliveryId]/resolve/route";

const req = (url: string, body?: unknown) =>
  new Request(`http://t${url}`, body !== undefined ? { method: "POST", body: JSON.stringify(body) } : undefined);
const P = <T>(v: T) => Promise.resolve(v);

beforeEach(() => {
  h.setSession({ user: { id: "u1", systemRole: "MEMBER", email: "u1@x", name: "U1", employmentType: "REGULAR", jobFunction: "PM" } });
  for (const k of ["getPermissionSummary", "getTaskList", "getTaskDetailView", "createTask", "cancelTask", "retryDelivery", "resolveDelivery"] as const) (h[k] as any).mockClear();
  h.getPermissionSummary.mockResolvedValue({ keys: ["workflows.weekly:view", "workflows.weekly:create", "workflows.weekly:send"] });
});

describe("GET /api/workflows", () => {
  it("미인증 → 401", async () => {
    h.setSession(null);
    expect((await listGET(req("/api/workflows"))).status).toBe(401);
  });
  it("성공 → 200, getTaskList에 permissionKeys 전달", async () => {
    h.getTaskList.mockResolvedValue([{ id: "t1", kind: "WEEKLY_REPORT", typeName: "주간보고", scheduledAt: "2026-06-12T00:00:00.000Z", status: "PENDING" }]);
    const res = await listGET(req("/api/workflows"));
    expect(res.status).toBe(200);
    const ctxArg = h.getTaskList.mock.calls[0][0];
    expect(ctxArg.permissionKeys.has("workflows.weekly:view")).toBe(true);
  });
  it("잘못된 status → 400", async () => {
    expect((await listGET(req("/api/workflows?status=NOPE"))).status).toBe(400);
  });
});

describe("POST /api/workflows", () => {
  it("잘못된 입력 → 400", async () => {
    expect((await createPOST(req("/api/workflows", { typeId: "" }))).status).toBe(400);
  });
  it("OWNER 세션이면 ctx.isOwner=true로 createTask 호출, 201", async () => {
    h.setSession({ user: { id: "u1", systemRole: "OWNER", email: "o@x", name: "O", employmentType: "REGULAR", jobFunction: "PM" } });
    const res = await createPOST(req("/api/workflows", { typeId: "wf-weekly", scheduledAt: "2026-06-20T00:00:00.000Z" }));
    expect(res.status).toBe(201);
    expect(h.createTask.mock.calls[0][1].isOwner).toBe(true);
  });
  it("createTask ForbiddenError → 403", async () => {
    h.createTask.mockRejectedValue(new h.FakeForbidden("denied"));
    expect((await createPOST(req("/api/workflows", { typeId: "x", scheduledAt: "2026-06-20T00:00:00.000Z" }))).status).toBe(403);
  });
});

describe("GET /api/workflows/[id]", () => {
  it("null → 404", async () => {
    h.getTaskDetailView.mockResolvedValue(null);
    expect((await detailGET(req("/api/workflows/t1"), { params: P({ id: "t1" }) })).status).toBe(404);
  });
  it("권한 없음(ForbiddenError) → 403", async () => {
    h.getTaskDetailView.mockRejectedValue(new h.FakeForbidden());
    expect((await detailGET(req("/api/workflows/t1"), { params: P({ id: "t1" }) })).status).toBe(403);
  });
  it("성공 → 200", async () => {
    h.getTaskDetailView.mockResolvedValue({ id: "t1", kind: "WEEKLY_REPORT", typeName: "주간보고", scheduledAt: "x", status: "PENDING", files: [], mailDeliveries: [], timeline: [] });
    expect((await detailGET(req("/api/workflows/t1"), { params: P({ id: "t1" }) })).status).toBe(200);
  });
});

describe("POST cancel", () => {
  it("성공 → 200", async () => {
    expect((await cancelPOST(req("/api/workflows/t1/cancel"), { params: P({ id: "t1" }) })).status).toBe(200);
    expect(h.cancelTask).toHaveBeenCalled();
  });
  it("ConflictError → 409", async () => {
    h.cancelTask.mockRejectedValue(new ConflictError());
    expect((await cancelPOST(req("/api/workflows/t1/cancel"), { params: P({ id: "t1" }) })).status).toBe(409);
  });
});

describe("POST mail retry", () => {
  it("성공 → 200", async () => {
    const res = await retryPOST(req("/api/workflows/t1/mail/d1/retry"), { params: P({ id: "t1", deliveryId: "d1" }) });
    expect(res.status).toBe(200);
    expect(h.retryDelivery).toHaveBeenCalledWith({ deliveryId: "d1", taskId: "t1" }, expect.objectContaining({ isAdmin: false }));
  });
  it("SENDING(ConflictError) → 409", async () => {
    h.retryDelivery.mockRejectedValue(new ConflictError());
    expect((await retryPOST(req("/api/workflows/t1/mail/d1/retry"), { params: P({ id: "t1", deliveryId: "d1" }) })).status).toBe(409);
  });
});

describe("POST mail resolve", () => {
  it("잘못된 to → 400", async () => {
    expect((await resolvePOST(req("/api/workflows/t1/mail/d1/resolve", { to: "NOPE" }), { params: P({ id: "t1", deliveryId: "d1" }) })).status).toBe(400);
  });
  it("ADMIN 세션 → isAdmin=true로 resolveDelivery 호출, 200", async () => {
    h.setSession({ user: { id: "a1", systemRole: "ADMIN", email: "a@x", name: "A", employmentType: "REGULAR", jobFunction: "PM" } });
    const res = await resolvePOST(req("/api/workflows/t1/mail/d1/resolve", { to: "FAILED" }), { params: P({ id: "t1", deliveryId: "d1" }) });
    expect(res.status).toBe(200);
    expect(h.resolveDelivery.mock.calls[0][1].isAdmin).toBe(true);
  });
  it("비-admin resolveDelivery ForbiddenError → 403", async () => {
    h.resolveDelivery.mockRejectedValue(new h.FakeForbidden());
    expect((await resolvePOST(req("/api/workflows/t1/mail/d1/resolve", { to: "SENT" }), { params: P({ id: "t1", deliveryId: "d1" }) })).status).toBe(403);
  });
});
```

## Step 2 — FAIL 확인

```bash
npm test -- tests/app/api/workflows/routes.test.ts
```

## Step 3 — validations 구현

생성: `src/modules/workflows/validations/index.ts`

```ts
import { z } from "zod";
import type { WorkflowStatus } from "@prisma/client";

const STATUS_VALUES = ["PENDING", "GENERATED", "REVIEWED", "SENT", "HQ_REQUESTED", "FINAL_SENT", "CANCELLED"] as const;

export const createTaskSchema = z.object({
  typeId: z.string().min(1),
  scheduledAt: z.string().min(1), // ISO 문자열. Date 변환·유효성은 라우트에서.
});

export const resolveSchema = z.object({
  to: z.enum(["SENT", "FAILED"]),
});

// CSV status → WorkflowStatus[]. 하나라도 무효면 null(라우트 400).
export function parseStatusList(csv: string): WorkflowStatus[] | null {
  const parts = csv.split(",").map((s) => s.trim()).filter(Boolean);
  const valid = new Set<string>(STATUS_VALUES);
  if (parts.length === 0 || parts.some((p) => !valid.has(p))) return null;
  return parts as WorkflowStatus[];
}
```

## Step 4 — 라우트 헬퍼 구현

생성: `src/app/api/workflows/_shared.ts`

```ts
import { NextResponse } from "next/server";
import { ForbiddenError } from "@/kernel/access";
import { ConflictError } from "@/modules/workflows/types";
import type { SessionUser } from "@/lib/auth/types";

// 알려진 도메인 에러만 상태로 매핑. 그 외는 rethrow(Next가 500).
export function mapError(error: unknown): NextResponse {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof ConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  throw error;
}

export function buildTransitionCtx(u: SessionUser, keys: string[], note?: string) {
  return { userId: u.id, isOwner: u.systemRole === "OWNER", permissionKeys: new Set(keys), note };
}

export function buildMailCtx(u: SessionUser, keys: string[]) {
  const isOwner = u.systemRole === "OWNER";
  return { userId: u.id, isOwner, isAdmin: isOwner || u.systemRole === "ADMIN", permissionKeys: new Set(keys) };
}

export function parseOptionalDate(v: string | null): Date | null | "invalid" {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}
```

## Step 5 — 라우트 구현 (5개 파일)

생성: `src/app/api/workflows/route.ts`

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { getTaskList } from "@/modules/workflows/services/tasks";
import { createTask } from "@/modules/workflows/services/lifecycle";
import { createTaskSchema, parseStatusList } from "@/modules/workflows/validations";
import { buildTransitionCtx, mapError, parseOptionalDate } from "./_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  let statuses;
  if (statusParam) {
    statuses = parseStatusList(statusParam);
    if (!statuses) return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  const start = parseOptionalDate(url.searchParams.get("start"));
  const end = parseOptionalDate(url.searchParams.get("end"));
  if (start === "invalid" || end === "invalid") return NextResponse.json({ error: "invalid range" }, { status: 400 });

  try {
    const summary = await getPermissionSummary(session.user.id);
    const items = await getTaskList(
      { permissionKeys: new Set(summary.keys) },
      { statuses, start: start ?? undefined, end: end ?? undefined },
    );
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const scheduledAt = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) return NextResponse.json({ error: "invalid scheduledAt" }, { status: 400 });

  try {
    const summary = await getPermissionSummary(session.user.id);
    const { id } = await createTask(
      { typeId: parsed.data.typeId, scheduledAt },
      buildTransitionCtx(session.user, summary.keys),
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return mapError(error);
  }
}
```

생성: `src/app/api/workflows/[id]/route.ts`

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { getTaskDetailView } from "@/modules/workflows/services/tasks";
import { mapError } from "../_shared";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;

  try {
    const summary = await getPermissionSummary(session.user.id);
    const detail = await getTaskDetailView(id, { permissionKeys: new Set(summary.keys) });
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
```

생성: `src/app/api/workflows/[id]/cancel/route.ts`

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { cancelTask } from "@/modules/workflows/services/lifecycle";
import { buildTransitionCtx, mapError } from "../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;

  // 본문은 선택(note). 없거나 비-JSON이면 무시.
  let note: string | undefined;
  try {
    const body = await req.json();
    if (body && typeof body === "object" && typeof (body as { note?: unknown }).note === "string") {
      note = (body as { note: string }).note;
    }
  } catch {
    /* 본문 없음 — 허용 */
  }

  try {
    const summary = await getPermissionSummary(session.user.id);
    await cancelTask(id, buildTransitionCtx(session.user, summary.keys, note));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
```

생성: `src/app/api/workflows/[id]/mail/[deliveryId]/retry/route.ts`

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { retryDelivery } from "@/modules/workflows/services/mail";
import { buildMailCtx, mapError } from "../../../../_shared";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; deliveryId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, deliveryId } = await params;

  try {
    const summary = await getPermissionSummary(session.user.id);
    const out = await retryDelivery({ deliveryId, taskId: id }, buildMailCtx(session.user, summary.keys));
    return NextResponse.json({ id: out.id, status: out.status });
  } catch (error) {
    return mapError(error);
  }
}
```

생성: `src/app/api/workflows/[id]/mail/[deliveryId]/resolve/route.ts`

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { resolveDelivery } from "@/modules/workflows/services/mail";
import { resolveSchema } from "@/modules/workflows/validations";
import { buildMailCtx, mapError } from "../../../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; deliveryId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, deliveryId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });

  try {
    const summary = await getPermissionSummary(session.user.id);
    const out = await resolveDelivery({ deliveryId, taskId: id, to: parsed.data.to }, buildMailCtx(session.user, summary.keys));
    return NextResponse.json({ id: out.id, status: out.status });
  } catch (error) {
    return mapError(error);
  }
}
```

## Step 6 — PASS

```bash
npm test -- tests/app/api/workflows/routes.test.ts
```

## Step 7 — commit

```bash
git add src/modules/workflows/validations src/app/api/workflows tests/app/api/workflows
git commit -m "feat(workflows): API routes (list/detail/create/cancel/mail retry+resolve) + zod"
```

## Acceptance Criteria

```bash
npm run typecheck   # 통과
npm run lint        # 통과(app→kernel/lib/module 허용; _shared는 app)
npm test -- tests/app/api/workflows/routes.test.ts   # PASS
```

## Cautions

- **generate/send 부수효과 라우트를 만들지 말 것.** 공통 기반은 표(SC-9)의 6개만. generate/send는 워크플로 sub-project가 추가한다(spec §9).
- **`params`는 `Promise`다(Next 16).** 반드시 `await params`. 시그니처는 `{ params }: { params: Promise<{…}> }`.
- ctx의 `isOwner`/`isAdmin`은 `getPermissionSummary` 키가 아니라 **`session.user.systemRole`**에서 도출한다 — cancel/resolve 게이트가 키만으로는 판정 불가(SC-8).
- 에러 매핑은 `_shared.mapError` 한 곳. 라우트마다 다른 매핑을 쓰지 말 것(일관 409/403).
- 입력 검증 실패(zod·status·date)는 service 호출 전에 400으로 끊는다 — 불필요한 권한/DB 접근 방지.
