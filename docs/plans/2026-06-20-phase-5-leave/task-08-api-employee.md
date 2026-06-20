# Task 08 — API 라우트 (직원)

**Purpose:** 직원용 연차 라우트 — 요약·내 신청 목록·신청·취소. 인증 필수, `requirePermission`으로 권한 게이트, zod 검증, `mapError`로 도메인 에러 매핑.

## Files
- Create: `src/app/api/leave/_shared.ts`
- Create: `src/app/api/leave/summary/route.ts`
- Create: `src/app/api/leave/requests/route.ts`
- Create: `src/app/api/leave/requests/[id]/cancel/route.ts`
- Create: `tests/app/api/leave/requests-route.test.ts`

## Prep
- spec §9 / entrypoint §SC-4, §SC-7, §SC-8.
- 라우트 패턴: workflows `route.ts`/`_shared.ts`/`[id]/cancel/route.ts` 참고. `[id]`는 `{ params }: { params: Promise<{ id: string }> }`, `const { id } = await params`.

## Deps
- 05 (allocations 서비스), 06 (requests 서비스), 07 (권한 키).

## Steps

### 1. _shared.ts
`src/app/api/leave/_shared.ts`:

```ts
import { NextResponse } from "next/server";
import type { LeaveRequestStatus } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { LeaveConflictError, LeaveValidationError } from "@/modules/leave/errors";
import type { SessionUser } from "@/lib/auth/types";

export function mapError(error: unknown): NextResponse {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof LeaveConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof LeaveValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  throw error;
}

export function buildLeaveCtx(u: SessionUser, keys: string[]) {
  return { userId: u.id, isOwner: u.systemRole === "OWNER", permissionKeys: new Set(keys) };
}

/** KST 현재 연도 기준 기본값. */
export function parseYear(v: string | null): number {
  const n = v ? Number(v) : NaN;
  if (Number.isInteger(n) && n >= 2000 && n <= 2100) return n;
  return new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

const ALL: LeaveRequestStatus[] = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
export function parseStatusList(v: string | null): LeaveRequestStatus[] | null | "invalid" {
  if (!v) return null;
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.some((p) => !ALL.includes(p as LeaveRequestStatus))) return "invalid";
  return parts as LeaveRequestStatus[];
}
```

### 2. summary/route.ts
`src/app/api/leave/summary/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { getAllocationSummary } from "@/modules/leave/services/allocations";
import { mapError, parseYear } from "../_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear(new URL(req.url).searchParams.get("year"));
  try {
    await requirePermission(session.user.id, "leave.request", "view");
    const summary = await getAllocationSummary(session.user.id, year);
    return NextResponse.json({ summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
```

### 3. requests/route.ts (GET 내 목록, POST 신청)
`src/app/api/leave/requests/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { listMyRequests, createLeaveRequest } from "@/modules/leave/services/requests";
import { createLeaveSchema } from "@/modules/leave/validations";
import { mapError, parseStatusList } from "../_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const statuses = parseStatusList(new URL(req.url).searchParams.get("status"));
  if (statuses === "invalid") return NextResponse.json({ error: "invalid status" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "leave.request", "view");
    const items = await listMyRequests(session.user.id, statuses ?? undefined);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = createLeaveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "leave.request", "create");
    const created = await createLeaveRequest(session.user.id, parsed.data);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    return mapError(error);
  }
}
```

### 4. requests/[id]/cancel/route.ts
`src/app/api/leave/requests/[id]/cancel/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { cancel } from "@/modules/leave/services/requests";
import { buildLeaveCtx, mapError } from "../../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let reason: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body === "object" && typeof (body as { reason?: unknown }).reason === "string") {
      reason = (body as { reason: string }).reason;
    }
  } catch { /* 본문 없음 허용 */ }
  try {
    await requirePermission(session.user.id, "leave.request", "cancel");
    const summary = await getPermissionSummary(session.user.id);
    await cancel(id, buildLeaveCtx(session.user, summary.keys), reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
```

### 5. 라우트 테스트(대표)
`tests/app/api/leave/requests-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth }));
const requirePermission = vi.fn();
const getPermissionSummary = vi.fn(async () => ({ keys: [] as string[] }));
vi.mock("@/kernel/access", () => ({
  requirePermission, getPermissionSummary,
  ForbiddenError: class ForbiddenError extends Error {},
}));
const createLeaveRequest = vi.fn();
const listMyRequests = vi.fn(async () => []);
vi.mock("@/modules/leave/services/requests", () => ({ createLeaveRequest, listMyRequests }));

import { GET, POST } from "@/app/api/leave/requests/route";

beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue({ user: { id: "u1", systemRole: "MEMBER" } }); });

describe("POST /api/leave/requests", () => {
  it("미인증 401", async () => {
    auth.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://x/api/leave/requests", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });
  it("잘못된 입력 400", async () => {
    const res = await POST(new Request("http://x/api/leave/requests", { method: "POST", body: JSON.stringify({ leaveType: "BOGUS" }) }));
    expect(res.status).toBe(400);
  });
  it("정상 신청 201", async () => {
    createLeaveRequest.mockResolvedValue({ id: "r1" });
    const body = JSON.stringify({ leaveType: "ANNUAL", startDate: "2999-08-14", endDate: "2999-08-14" });
    const res = await POST(new Request("http://x/api/leave/requests", { method: "POST", body }));
    expect(res.status).toBe(201);
    expect(requirePermission).toHaveBeenCalledWith("u1", "leave.request", "create");
  });
});

describe("GET /api/leave/requests", () => {
  it("미인증 401", async () => {
    auth.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x/api/leave/requests"));
    expect(res.status).toBe(401);
  });
});
```

```
npm test -- tests/app/api/leave/requests-route   # FAIL→PASS
```

### 6. 커밋
```
git add src/app/api/leave tests/app/api/leave
git commit -m "feat(leave): 직원 API(요약·내 신청·신청·취소)"
```

## Acceptance Criteria
- `npm test -- tests/app/api/leave/requests-route` → PASS.
- `npm run typecheck` / `npm run lint` → 그린.

## Cautions
- **Don't `requirePermission`을 try 밖에서 호출하지 말 것.** Reason: ForbiddenError를 `mapError`가 403으로 매핑해야 한다 — try 안에서.
- **Don't cancel에 `leave.approval:approve`를 요구하지 말 것.** Reason: 본인 취소는 `leave.request:cancel`. 관리자 권한은 서비스의 isManager 분기가 처리(SC-7).
- **Don't `[id]/cancel`의 상대 import 깊이를 틀리지 말 것.** Reason: `requests/[id]/cancel/route.ts` → `_shared`는 `../../../_shared`(3단계).
