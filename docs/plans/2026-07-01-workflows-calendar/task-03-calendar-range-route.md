# Task 03 — 캘린더 조회 라우트·서비스 (서버 range 강제, D5)

캘린더 전용 조회 경로를 만든다: `getCalendarTasks` 서비스(비-optional `start`/`end` = 타입 강제 range 계약) + 전용 `GET /api/workflows/calendar` 라우트(range 필수·span cap·운영창 검증, 위반 시 400). 기존 `GET /api/workflows`는 불변.

## Files
- Modify: `src/modules/workflows/services/tasks.ts` (`getCalendarTasks` 추가)
- Create: `src/app/api/workflows/calendar/route.ts` (`GET`)
- Test: `tests/modules/workflows/tasks-service.test.ts` (`getCalendarTasks` describe 추가)
- Test: `tests/app/api/workflows/calendar-route.test.ts` (신규 — 라우트 range 계약)

## Prep
- 엔트리포인트 §Shared Contracts SC-9(캘린더 조회 계약 — 전용 라우트 확정), SC-3(allow-list).
- 참조: `src/app/api/leave/calendar/route.ts`(range 검증 관례), `tests/app/api/leave/calendar-route.test.ts`(테스트 관례), `src/app/api/workflows/route.ts`(기존 GET·`_shared` mapError), `src/modules/workflows/repositories/index.ts`(`findTaskList`가 `scheduledAt gte start, lt end`).
- D5(서버 range 강제·전체이력 반환 금지), R4·F2(exclusive end half-open).

## Deps
- Task 01(`ALL_KINDS` enum-파생 — `allowedKinds`가 신규 kind 포함).

## Cautions
- **Don't 기존 `GET /api/workflows`(route.ts)를 바꾸지 마라.** 그건 status 필터·optional range 유지(routes.test.ts 보존). 캘린더 계약은 **전용 `/calendar` 라우트**에 격리(SC-9).
- **Don't 빈 파라미터를 전체 조회로 흘리지 마라.** `start`/`end` 누락·빈값은 **400**(연차와 달리 현재월 default도 두지 않는다 — D5). fail-closed.
- **Don't `winEnd-1`을 기대하지 마라.** 클라는 exclusive `end=winEnd`를 보낸다. 라우트는 그 값을 그대로 검증·전달(`scheduledAt < end`가 마지막 그리드 셀 포함, R4·F2).
- **Don't range 위반을 `mapError`에 맡기지 마라.** `mapError`는 도메인 에러만 매핑(그 외 500). range 위반은 라우트가 직접 `NextResponse.json(..., {status:400})`로 반환.

## TDD Steps

### 1. getCalendarTasks — 실패 테스트 먼저

`tests/modules/workflows/tasks-service.test.ts`에 import를 갱신하고 describe를 추가한다.

import 줄(12행 부근)을 교체:
```ts
import { getTaskList, getTaskDetailView, getCalendarTasks } from "@/modules/workflows/services/tasks";
```

파일 하단(`describe("recordGeneratedFiles"…)` 앞)에 추가:
```ts
describe("getCalendarTasks (서버 range 계약, D5)", () => {
  it("start<end면 allowed kind + range를 repo에 전달·ISO 직렬화", async () => {
    m.findTaskList.mockResolvedValue([{ id: "t1", kind: "BILLING", typeName: "대금청구", scheduledAt: new Date("2026-07-10T00:00:00Z"), status: "PENDING" }]);
    const start = new Date("2026-07-01T00:00:00Z");
    const end = new Date("2026-08-12T00:00:00Z");
    const out = await getCalendarTasks({ permissionKeys: new Set(["workflows.billing:view"]) }, { start, end });
    expect(m.findTaskList).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["BILLING"], start, end }));
    expect(out[0]).toEqual({ id: "t1", kind: "BILLING", typeName: "대금청구", scheduledAt: "2026-07-10T00:00:00.000Z", status: "PENDING" });
  });

  it("start>=end면 RangeError(방어 — 라우트가 먼저 400이지만 서비스도 강제)", async () => {
    const d = new Date("2026-07-01T00:00:00Z");
    await expect(
      getCalendarTasks({ permissionKeys: new Set(["workflows.billing:view"]) }, { start: d, end: d }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("view 권한 없으면 kinds=[]", async () => {
    await getCalendarTasks({ permissionKeys: new Set() }, { start: new Date("2026-07-01T00:00:00Z"), end: new Date("2026-07-02T00:00:00Z") });
    expect(m.findTaskList).toHaveBeenCalledWith(expect.objectContaining({ kinds: [] }));
  });
});
```

실행: `npm test -- tests/modules/workflows/tasks-service.test.ts` → **FAIL**(`getCalendarTasks` 없음).

### 2. getCalendarTasks 구현

`src/modules/workflows/services/tasks.ts`의 `getTaskList` 함수 바로 뒤(닫는 `}` 다음)에 추가:

```ts
// 캘린더 전용 조회(D5). start/end 비-optional = 타입-레벨 range 계약(서버가 무제한 조회를 구조적으로 차단).
// 런타임 방어로 start<end 강제(RangeError). kind 필터는 응답을 받은 클라가 수행(kind는 민감정보 아님, D5).
export async function getCalendarTasks(
  ctx: { permissionKeys: Set<string> },
  range: { start: Date; end: Date },
): Promise<TaskListItem[]> {
  if (!(range.start.getTime() < range.end.getTime())) {
    throw new RangeError("조회 범위가 올바르지 않습니다(start<end).");
  }
  const kinds = allowedKinds(ctx.permissionKeys);
  const rows = await findTaskList({ kinds, start: range.start, end: range.end });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    typeName: r.typeName,
    scheduledAt: r.scheduledAt.toISOString(),
    status: r.status,
  }));
}
```

실행: `npm test -- tests/modules/workflows/tasks-service.test.ts` → **PASS**.

### 3. 라우트 — 실패 테스트 먼저

`tests/app/api/workflows/calendar-route.test.ts` 생성(leave calendar-route.test 관례 계승 — 서비스 mock):

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { normalizeToGridWindow } from "@/modules/calendar/time";

const h = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ user: { id: "u1", systemRole: "MEMBER" } } as any)),
  getPermissionSummary: vi.fn(async () => ({ keys: ["workflows.billing:view"] as string[] })),
  getCalendarTasks: vi.fn(async () => [] as any[]),
}));
vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...args: unknown[]) => unknown)(...a),
  ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } },
}));
vi.mock("@/modules/workflows/services/tasks", () => ({
  getCalendarTasks: (...a: unknown[]) => (h.getCalendarTasks as (...args: unknown[]) => unknown)(...a),
}));

import { GET } from "@/app/api/workflows/calendar/route";

// 현재월 그리드의 exclusive end(=winEnd, 클라가 보내는 값)
function monthAnchor(monthOffset: number): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset, 15, 3, 0, 0));
}
function gridKeys(monthOffset: number): { start: string; end: string } {
  const { start, end } = normalizeToGridWindow(monthAnchor(monthOffset));
  return { start: start.toISOString(), end: end.toISOString() }; // end = exclusive winEnd(R4·F2)
}
const url = (qs: string) => new Request(`http://x/api/workflows/calendar${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", systemRole: "MEMBER" } });
  h.getPermissionSummary.mockResolvedValue({ keys: ["workflows.billing:view"] });
  h.getCalendarTasks.mockResolvedValue([]);
});

describe("GET /api/workflows/calendar", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await GET(url(""))).status).toBe(401);
  });

  it("start/end 누락 → 400(전체 이력 반환 금지, D5)", async () => {
    expect((await GET(url(""))).status).toBe(400);
    expect(h.getCalendarTasks).not.toHaveBeenCalled();
  });

  it("빈 파라미터 → 400", async () => {
    expect((await GET(url("?start=&end="))).status).toBe(400);
  });

  it("비파싱 값 → 400", async () => {
    const { start } = gridKeys(0);
    expect((await GET(url(`?start=${start}&end=not-a-date`))).status).toBe(400);
  });

  it("start>=end(역순) → 400", async () => {
    const { start, end } = gridKeys(0);
    expect((await GET(url(`?start=${end}&end=${start}`))).status).toBe(400);
  });

  it("과대 span(>46일) → 400", async () => {
    // 운영창 안(현재월~+2개월)이어도 span(~59~62일)이 46일 cap 초과 → 400.
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1)).toISOString();
    expect((await GET(url(`?start=${start}&end=${end}`))).status).toBe(400);
  });

  it("운영창(now±13개월) 밖 → 400", async () => {
    // 2000년은 어떤 실행 시각에서도 밖
    expect((await GET(url("?start=2000-01-01T00:00:00.000Z&end=2000-01-05T00:00:00.000Z"))).status).toBe(400);
  });

  it("현재월 그리드(exclusive end) → 200 + getCalendarTasks에 Date range 전달", async () => {
    const { start, end } = gridKeys(0);
    const res = await GET(url(`?start=${start}&end=${end}`));
    expect(res.status).toBe(200);
    const [, range] = h.getCalendarTasks.mock.calls[0] as unknown as [unknown, { start: Date; end: Date }];
    expect(range.start.toISOString()).toBe(start);
    expect(range.end.toISOString()).toBe(end); // exclusive end 그대로(R4·F2)
  });

  it("+12개월 경계 그리드는 200(grid spillover 수용)", async () => {
    const { start, end } = gridKeys(12);
    expect((await GET(url(`?start=${start}&end=${end}`))).status).toBe(200);
  });

  it("+14개월 그리드는 400(+1 여유는 무제한 아님)", async () => {
    const { start, end } = gridKeys(14);
    expect((await GET(url(`?start=${start}&end=${end}`))).status).toBe(400);
  });

  it("200 응답은 {items} + no-store", async () => {
    h.getCalendarTasks.mockResolvedValueOnce([{ id: "t1", kind: "BILLING", typeName: "대금청구", scheduledAt: "2026-07-10T00:00:00.000Z", status: "PENDING" }]);
    const { start, end } = gridKeys(0);
    const res = await GET(url(`?start=${start}&end=${end}`));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });
});
```

실행: `npm test -- tests/app/api/workflows/calendar-route.test.ts` → **FAIL**(라우트 없음).

### 4. 라우트 구현

`src/app/api/workflows/calendar/route.ts` 생성:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { getCalendarTasks } from "@/modules/workflows/services/tasks";
import { isAnchorWithinWindow } from "@/modules/calendar/time";
import { MAX_ANCHOR_MONTHS } from "@/modules/calendar/constants";
import { mapError } from "../_shared";

const MS_PER_DAY = 86_400_000;
const MAX_WINDOW_DAYS = 46; // 월 그리드 6주(42일) + 여유. 무제한 조회 차단(D5)
// 월 그리드는 인접월로 ~1주 spillover → 허용 anchor(±MAX_ANCHOR_MONTHS) 월의 grid 끝이 ±(MAX_ANCHOR_MONTHS+1)월에 닿음(leave와 동일).
const MAX_EDGE_MONTHS = MAX_ANCHOR_MONTHS + 1;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(req.url);
  const startStr = url.searchParams.get("start");
  const endStr = url.searchParams.get("end");
  // D5: range 필수 — 누락·빈값은 400(전체 이력 반환 금지, 클라 규율에 의존하지 않음).
  if (!startStr || !endStr) return NextResponse.json({ error: "range required" }, { status: 400 });
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return NextResponse.json({ error: "invalid range" }, { status: 400 });
  if (start.getTime() >= end.getTime())
    return NextResponse.json({ error: "start must be before end" }, { status: 400 });
  if (end.getTime() - start.getTime() > MAX_WINDOW_DAYS * MS_PER_DAY)
    return NextResponse.json({ error: "range too wide" }, { status: 400 });
  const now = new Date();
  if (!isAnchorWithinWindow(start, now, MAX_EDGE_MONTHS) || !isAnchorWithinWindow(end, now, MAX_EDGE_MONTHS))
    return NextResponse.json({ error: "range out of window" }, { status: 400 });

  try {
    const summary = await getPermissionSummary(session.user.id);
    // end는 exclusive(클라가 winEnd 그대로 전송) — repo가 scheduledAt<end라 마지막 그리드 셀 포함(R4·F2).
    const items = await getCalendarTasks({ permissionKeys: new Set(summary.keys) }, { start, end });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
```

실행: `npm test -- tests/app/api/workflows/calendar-route.test.ts` → **PASS**.

### 5. 커밋

```bash
npm run typecheck && npm run lint && npm test -- tests/modules/workflows/tasks-service.test.ts tests/app/api/workflows/calendar-route.test.ts
```
기대: 전부 green(기존 `routes.test.ts`도 불변 — 기존 GET 미변경). 이후 커밋.

## Acceptance Criteria
- `npm run typecheck` → 통과(`getCalendarTasks` range 비-optional).
- `npm run lint` → 통과.
- `npm test -- tests/modules/workflows/tasks-service.test.ts tests/app/api/workflows/calendar-route.test.ts` → 통과.
- 라우트: start/end 누락·빈값·비파싱·역순·과대 span·운영창 밖 → 각 400; 현재월 그리드(exclusive end) → 200 + `{items}`·no-store; +12개월 200 / +14개월 400.
- 기존 `GET /api/workflows`(`routes.test.ts`) 회귀 없음.
