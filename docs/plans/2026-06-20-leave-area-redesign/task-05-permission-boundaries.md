# Task 05 — 권한 경계: 승인 전용 라우트 + 전체이력 leave.admin:view

**목적:** 승인 큐와 전체 이력의 권한 청중을 분리한다(spec §4 finding). 승인 큐는 전용 `GET /api/admin/leave/approvals`(`leave.approval:view`), 전체 이력 조회는 `GET /api/admin/leave/requests` GET 가드를 `leave.admin:view`로 변경. 두 응답에 사용자 이름·부서를 병합한다(cross-schema이므로 별도 조회).

## Files
- Create: `src/app/api/admin/leave/approvals/route.ts`
- Modify: `src/app/api/admin/leave/requests/route.ts` (GET 가드만 변경; POST 유지)
- Modify: `src/modules/leave/services/requests.ts` (listAllRequestsWithUser 추가)
- Modify: `src/app/(app)/leave/approvals/approvals-client.tsx` (fetch URL 교체)
- Create: `tests/modules/leave/list-with-user.test.ts`
- Create: `tests/app/admin-leave-approvals-route.test.ts`

## Prep
- 엔트리포인트 §SC-2(권한 경계 규칙), §SC-1(라우트 표준 패턴, mapError).
- 기존 `GET /api/admin/leave/requests`(requests/route.ts:14)는 `leave.approval:view`로 가드 중 — 이를 `leave.admin:view`로.
- `User`(kernel)와 `LeaveRequest`(leave)는 **cross-schema이고 Prisma relation이 없다** → `include: { user }` 불가. service에서 userId로 별도 `prisma.user.findMany` 병합.
- 기존 `listAllRequests`(services/requests.ts:69) = `listRequests(filter)`(user 없음).

## Deps
Task 01(leave.admin:view 키).

## Steps

### 1. (TDD) listAllRequestsWithUser 테스트 → FAIL

`tests/modules/leave/list-with-user.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: vi.fn() } } }));
vi.mock("@/kernel/holidays", () => ({ getHolidaysInRange: vi.fn(), ensureYearsSynced: vi.fn(), getUnsyncedYears: vi.fn() }));
vi.mock("@/modules/leave/repositories", () => ({
  getRequestById: vi.fn(), listRequests: vi.fn(), findActiveAllocation: vi.fn(), findOverlap: vi.fn(),
  createPendingRequest: vi.fn(), createApprovedRequestTx: vi.fn(), approveTx: vi.fn(), rejectRequest: vi.fn(),
  cancelTx: vi.fn(), updateByAdminTx: vi.fn(), deleteByAdminTx: vi.fn(),
}));

import { listAllRequestsWithUser } from "@/modules/leave/services/requests";
import * as repo from "@/modules/leave/repositories";
import { prisma } from "@/lib/prisma";

beforeEach(() => vi.clearAllMocks());

describe("listAllRequestsWithUser", () => {
  it("요청에 user(name/department/email)를 병합", async () => {
    vi.mocked(repo.listRequests).mockResolvedValue([
      { id: "r1", userId: "u1" }, { id: "r2", userId: "u2" },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", name: "김", department: "개발", email: "k@x.com" },
      { id: "u2", name: "이", department: "기획", email: "l@x.com" },
    ] as never);
    const out = await listAllRequestsWithUser({ statuses: ["PENDING"] });
    expect(out[0]).toMatchObject({ id: "r1", user: { name: "김", department: "개발" } });
    expect(out[1].user?.name).toBe("이");
  });
  it("user 못 찾으면 user=null", async () => {
    vi.mocked(repo.listRequests).mockResolvedValue([{ id: "r1", userId: "u9" }] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    const out = await listAllRequestsWithUser({});
    expect(out[0].user).toBeNull();
  });
});
```
실행 → **FAIL**.

### 2. listAllRequestsWithUser 구현 → PASS

`src/modules/leave/services/requests.ts` 상단 import에 `prisma` 추가:
```ts
import { prisma } from "@/lib/prisma";
```
`listAllRequests` 함수(line 69) 바로 아래 추가:
```ts
// 전체(타인 포함) 신청 + 사용자 표시정보. User(kernel)↔LeaveRequest(leave)는 cross-schema relation이
// 없으므로 userId로 별도 조회해 병합한다(승인 큐·전체 이력 공유).
export async function listAllRequestsWithUser(filter: { userId?: string; statuses?: LeaveRequestStatus[] }) {
  const items = await listRequests(filter);
  const userIds = [...new Set(items.map((i) => i.userId))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, department: true, email: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return items.map((i) => ({ ...i, user: byId.get(i.userId) ?? null }));
}
```
실행: 1번 → **PASS**.

### 3. 승인 전용 라우트

`src/app/api/admin/leave/approvals/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { listAllRequestsWithUser } from "@/modules/leave/services/requests";
import { mapError } from "@/app/api/leave/_shared";

// 승인 대기 큐 전용. leave.approval:view로 가드 — 전체 이력 권한(leave.admin:view)을 요구하지 않는다.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    await requirePermission(session.user.id, "leave.approval", "view");
    const items = await listAllRequestsWithUser({ statuses: ["PENDING"] });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
```

### 4. 전체 이력 GET 가드 변경 + user 병합

`src/app/api/admin/leave/requests/route.ts`의 GET만 수정:
- import에 `listAllRequestsWithUser` 추가(기존 `listAllRequests`는 더 이상 GET에서 쓰지 않으면 import 정리).
- 가드를 `leave.admin:view`로, 목록은 WithUser로:
```ts
    await requirePermission(session.user.id, "leave.admin", "view");
    const items = await listAllRequestsWithUser({ userId, statuses: statuses ?? undefined });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
```
**POST 핸들러(직접입력)는 그대로 `leave.approval:approve` 유지.** 변경 금지.

### 5. approvals-client 데이터 소스 교체

`src/app/(app)/leave/approvals/approvals-client.tsx`의 `fetchPending`만 교체:
```ts
async function fetchPending(): Promise<Req[]> {
  const res = await fetch("/api/admin/leave/approvals", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`pending ${res.status}`);
  return (await res.json()).items as Req[];
}
```
(나머지 컴포넌트 로직·승인/반려 API 호출은 그대로.)

### 6. (TDD) 승인 라우트 가드 스모크 → PASS

`tests/app/admin-leave-approvals-route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const requirePermissionMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/kernel/access", () => ({ requirePermission: requirePermissionMock, ForbiddenError: class ForbiddenError extends Error {} }));
vi.mock("@/modules/leave/services/requests", () => ({ listAllRequestsWithUser: vi.fn(async () => []) }));

import { GET } from "@/app/api/admin/leave/approvals/route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/admin/leave/approvals", () => {
  it("미인증이면 401", async () => {
    authMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
  it("leave.approval:view로 가드한다", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    requirePermissionMock.mockResolvedValue(undefined);
    const res = await GET();
    expect(requirePermissionMock).toHaveBeenCalledWith("u1", "leave.approval", "view");
    expect(res.status).toBe(200);
  });
});
```
실행 → **PASS**.

## Acceptance Criteria
- `npx vitest run tests/modules/leave/list-with-user.test.ts tests/app/admin-leave-approvals-route.test.ts` → all passed.
- `npm test` → 회귀 없음(기존 requests-service 테스트 그대로).
- `npm run typecheck` / `npm run lint` / `npm run build` → 통과.
- 코드 점검: `GET /api/admin/leave/requests`가 `leave.admin:view`, POST가 `leave.approval:approve`, `/api/admin/leave/approvals`가 `leave.approval:view`.

## Cautions
- **Don't** `GET /api/admin/leave/requests`의 POST(직접입력) 가드까지 바꾸지 마라. GET만 `leave.admin:view`로, POST는 `leave.approval:approve` 유지.
- **Don't** 승인 큐가 `leave.admin:view`를 요구하게 만들지 마라. 이유: 승인자와 전체이력 열람자는 청중이 다르다(spec §4) — 승인 큐는 `leave.approval:view`만으로 동작해야 한다.
- **Don't** `include: { user: true }`로 LeaveRequest에서 User를 끌어오려 하지 마라. 이유: cross-schema relation이 정의돼 있지 않다 — 별도 `findMany` 병합.
