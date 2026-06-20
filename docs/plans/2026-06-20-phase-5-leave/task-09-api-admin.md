# Task 09 — API 라우트 (관리자)

**Purpose:** 관리자용 연차 라우트 — 전체/대기 목록·직접입력·승인·반려·수정·삭제·할당 설정/조정/recalculate/이력·공휴일 수동 sync. `@/app/api/leave/_shared`(task 08)의 `mapError`/`buildLeaveCtx`/`parseYear` 재사용.

## Files
- Create: `src/app/api/admin/leave/requests/route.ts` (GET, POST)
- Create: `src/app/api/admin/leave/requests/[id]/approve/route.ts` (POST)
- Create: `src/app/api/admin/leave/requests/[id]/reject/route.ts` (POST)
- Create: `src/app/api/admin/leave/requests/[id]/route.ts` (PATCH, DELETE)
- Create: `src/app/api/admin/leave/allocations/route.ts` (GET)
- Create: `src/app/api/admin/leave/allocations/[userId]/[year]/route.ts` (PUT)
- Create: `src/app/api/admin/leave/allocations/[userId]/[year]/adjust/route.ts` (POST)
- Create: `src/app/api/admin/leave/allocations/[userId]/[year]/recalculate/route.ts` (POST)
- Create: `src/app/api/admin/leave/allocations/[userId]/history/route.ts` (GET)
- Create: `src/app/api/admin/leave/holidays/sync/route.ts` (GET 미적재 status, POST sync)
- Create: `tests/app/api/admin/leave/approve-route.test.ts`

## Prep
- spec §9 / entrypoint §SC-4, §SC-6(syncHolidaysForYear), §SC-7, §SC-8.
- 공유 헬퍼는 `@/app/api/leave/_shared`(alias)로 import — 상대경로 깊이 버그 회피.
- `[userId]/[year]`: `{ params }: { params: Promise<{ userId: string; year: string }> }`, year는 `Number()` 파싱.

## Deps
- 02(holidays sync), 05(allocations), 06(requests), 07(권한).

## Steps

### 1. requests/route.ts (GET 전체/대기, POST 직접입력)
`src/app/api/admin/leave/requests/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { listAllRequests, createLeaveRequestByAdmin } from "@/modules/leave/services/requests";
import { adminCreateLeaveSchema } from "@/modules/leave/validations";
import { mapError, parseStatusList } from "@/app/api/leave/_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(req.url);
  const statuses = parseStatusList(url.searchParams.get("status"));
  if (statuses === "invalid") return NextResponse.json({ error: "invalid status" }, { status: 400 });
  const userId = url.searchParams.get("userId") ?? undefined;
  try {
    await requirePermission(session.user.id, "leave.approval", "view");
    const items = await listAllRequests({ userId, statuses: statuses ?? undefined });
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
  const parsed = adminCreateLeaveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const { userId, ...input } = parsed.data;
  try {
    await requirePermission(session.user.id, "leave.approval", "approve"); // 직접입력은 자동 승인 → approve 권한
    const created = await createLeaveRequestByAdmin(session.user.id, userId, input);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    return mapError(error);
  }
}
```

### 2. requests/[id]/approve · reject
`src/app/api/admin/leave/requests/[id]/approve/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { approve } from "@/modules/leave/services/requests";
import { mapError } from "@/app/api/leave/_shared";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    await requirePermission(session.user.id, "leave.approval", "approve");
    await approve(id, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
```

`src/app/api/admin/leave/requests/[id]/reject/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { reject } from "@/modules/leave/services/requests";
import { rejectSchema } from "@/modules/leave/validations";
import { mapError } from "@/app/api/leave/_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "leave.approval", "approve");
    await reject(id, session.user.id, parsed.data.rejectionReason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
```

### 3. requests/[id]/route.ts (PATCH 수정, DELETE 삭제)
`src/app/api/admin/leave/requests/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { updateByAdmin, deleteByAdmin } from "@/modules/leave/services/requests";
import { updateLeaveSchema } from "@/modules/leave/validations";
import { mapError } from "@/app/api/leave/_shared";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = updateLeaveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "leave.request", "update");
    const updated = await updateByAdmin(id, parsed.data);
    return NextResponse.json({ id: updated.id });
  } catch (error) {
    return mapError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    await requirePermission(session.user.id, "leave.request", "delete");
    await deleteByAdmin(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
```

### 4. allocations 라우트
`src/app/api/admin/leave/allocations/route.ts` (GET 연도별 전체):

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { listAllocations } from "@/modules/leave/services/allocations";
import { mapError, parseYear } from "@/app/api/leave/_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear(new URL(req.url).searchParams.get("year"));
  try {
    await requirePermission(session.user.id, "leave.allocation", "view");
    const items = await listAllocations(year);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
```

`src/app/api/admin/leave/allocations/[userId]/[year]/route.ts` (PUT 설정):

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { setAllocation } from "@/modules/leave/services/allocations";
import { upsertAllocationSchema } from "@/modules/leave/validations";
import { mapError } from "@/app/api/leave/_shared";

export async function PUT(req: Request, { params }: { params: Promise<{ userId: string; year: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { userId, year } = await params;
  const y = Number(year);
  if (!Number.isInteger(y)) return NextResponse.json({ error: "invalid year" }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = upsertAllocationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "leave.allocation", "configure");
    const alloc = await setAllocation(userId, y, parsed.data);
    return NextResponse.json({ id: alloc.id });
  } catch (error) {
    return mapError(error);
  }
}
```

`src/app/api/admin/leave/allocations/[userId]/[year]/adjust/route.ts` (POST 조정):

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { adjustAllocation } from "@/modules/leave/services/allocations";
import { adjustAllocationSchema } from "@/modules/leave/validations";
import { mapError } from "@/app/api/leave/_shared";

export async function POST(req: Request, { params }: { params: Promise<{ userId: string; year: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { userId, year } = await params;
  const y = Number(year);
  if (!Number.isInteger(y)) return NextResponse.json({ error: "invalid year" }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = adjustAllocationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "leave.allocation", "configure");
    const { allocation } = await adjustAllocation({ userId, year: y, ...parsed.data }, session.user.id);
    return NextResponse.json({ id: allocation.id });
  } catch (error) {
    return mapError(error);
  }
}
```

`src/app/api/admin/leave/allocations/[userId]/[year]/recalculate/route.ts` (POST):

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { recalculate } from "@/modules/leave/services/allocations";
import { mapError } from "@/app/api/leave/_shared";

export async function POST(_req: Request, { params }: { params: Promise<{ userId: string; year: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { userId, year } = await params;
  const y = Number(year);
  if (!Number.isInteger(y)) return NextResponse.json({ error: "invalid year" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "leave.allocation", "configure");
    const usedDays = await recalculate(userId, y);
    return NextResponse.json({ usedDays });
  } catch (error) {
    return mapError(error);
  }
}
```

`src/app/api/admin/leave/allocations/[userId]/history/route.ts` (GET):

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { getAllocationHistory } from "@/modules/leave/services/allocations";
import { mapError, parseYear } from "@/app/api/leave/_shared";

export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { userId } = await params;
  const yearParam = new URL(req.url).searchParams.get("year");
  const year = yearParam ? parseYear(yearParam) : undefined;
  try {
    await requirePermission(session.user.id, "leave.allocation", "view");
    const items = await getAllocationHistory(userId, year);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
```

### 5. 공휴일 미적재 status(GET) + 수동 sync(POST)
`src/app/api/admin/leave/holidays/sync/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { syncHolidaysForYear, getUnsyncedYears } from "@/kernel/holidays";
import { mapError, parseYear } from "@/app/api/leave/_shared";

// 현재+익년 중 미적재 연도 조회(admin 미적재 알림용). view 권한.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const now = new Date().getFullYear();
  try {
    await requirePermission(session.user.id, "leave.allocation", "view");
    const unsynced = await getUnsyncedYears([now, now + 1]);
    return NextResponse.json({ unsynced }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear(new URL(req.url).searchParams.get("year"));
  try {
    await requirePermission(session.user.id, "leave.allocation", "configure");
    const count = await syncHolidaysForYear(year);
    return NextResponse.json({ year, count });
  } catch (error) {
    return mapError(error);
  }
}
```

### 6. 라우트 테스트(대표 — approve)
`tests/app/api/admin/leave/approve-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth }));
const requirePermission = vi.fn();
vi.mock("@/kernel/access", () => ({ requirePermission, ForbiddenError: class extends Error {} }));
const approve = vi.fn();
vi.mock("@/modules/leave/services/requests", () => ({ approve }));
vi.mock("@/app/api/leave/_shared", () => ({ mapError: (e: unknown) => { throw e; } }));

import { POST } from "@/app/api/admin/leave/requests/[id]/approve/route";
const ctx = { params: Promise.resolve({ id: "r1" }) };

beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue({ user: { id: "admin1", systemRole: "OWNER" } }); });

it("미인증 401", async () => {
  auth.mockResolvedValueOnce(null);
  const res = await POST(new Request("http://x"), ctx);
  expect(res.status).toBe(401);
});
it("승인 ok + 권한 검사", async () => {
  const res = await POST(new Request("http://x"), ctx);
  expect(res.status).toBe(200);
  expect(requirePermission).toHaveBeenCalledWith("admin1", "leave.approval", "approve");
  expect(approve).toHaveBeenCalledWith("r1", "admin1");
});
```

```
npm test -- tests/app/api/admin/leave/approve-route   # FAIL→PASS
```

### 7. 커밋
```
git add src/app/api/admin/leave tests/app/api/admin/leave
git commit -m "feat(leave): 관리자 API(승인·반려·수정·삭제·할당·조정·recalc·공휴일 sync)"
```

## Acceptance Criteria
- `npm test -- tests/app/api/admin/leave` → PASS.
- `npm run typecheck` / `npm run lint` → 그린.

## Cautions
- **Don't 공유 헬퍼를 상대경로로 import하지 말 것.** Reason: 라우트 중첩 깊이가 제각각 — `@/app/api/leave/_shared` alias로 통일.
- **Don't 직접입력(POST requests)을 `leave.request:create`만으로 게이트하지 말 것.** Reason: 자동 APPROVED라 승인 권한(`leave.approval:approve`)이 정책상 맞다(spec §9).
- **Don't `requirePermission`을 try 밖에 두지 말 것.** Reason: 403 매핑(SC-8).
