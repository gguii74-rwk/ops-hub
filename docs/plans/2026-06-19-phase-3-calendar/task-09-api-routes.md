# Task 09 — API: GET feed + POST refresh

`GET /api/calendar/feed`와 `POST /api/calendar/refresh`. 둘 다 인증 → `requirePermission(calendar.{view}:view)` → **앵커 운영 창 검증** → range 정규화 → `FeedContext` 구성 → `buildFeed`. refresh는 `forceRefresh:true` provider로 (view,range) 범위만 재검증(min-interval은 cache가 가드). 앵커는 운영 창(±`MAX_ANCHOR_MONTHS`)으로 제한해 무제한 달 열거를 막는다. provider 조립 헬퍼도 여기서 만든다.

## Files

- Create: `src/modules/calendar/providers.ts`
- Create: `src/app/api/calendar/feed/route.ts`
- Create: `src/app/api/calendar/refresh/route.ts`
- Test: `tests/app/api/calendar/feed.test.ts`

## Prep

- 패턴: `src/app/api/admin/settings/route.ts`(auth→try/catch ForbiddenError→403, no-store) + `tests/app/api/admin/settings.test.ts`(auth/access mock).
- 엔트리포인트 §Shared Contracts: `VIEW_PERMISSION`, `isViewKey`, `normalizeToGridWindow`, `buildFeed`, `FeedContext`.
- access: `requirePermission`, `getPermissionSummary`, `ForbiddenError`(`@/kernel/access`).

## Deps

08 (buildFeed), 05·06 (providers.ts가 wiring).

## Steps

### 1. provider 조립 헬퍼 작성

`src/modules/calendar/providers.ts`:

```ts
import type { CalendarSourceProvider } from "./types";
import { internalLeaveProvider } from "./sources/internalLeave";
import { workflowTaskProvider } from "./sources/workflowTask";
import { manualProvider } from "./sources/manual";
import { createGoogleProvider } from "./sources/google";
import { createHolidayProvider } from "./sources/holiday";

export function createCalendarProviders(opts: { forceRefresh?: boolean } = {}): Record<string, CalendarSourceProvider> {
  return {
    internalLeave: internalLeaveProvider,
    workflowTask: workflowTaskProvider,
    manual: manualProvider,
    google: createGoogleProvider({ forceRefresh: opts.forceRefresh }),
    holiday: createHolidayProvider({ forceRefresh: opts.forceRefresh }),
  };
}
```

### 2. 라우트 테스트 먼저 (FAIL 확인)

`tests/app/api/calendar/feed.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  let session: any = { user: { id: "u1" } };
  class FakeForbidden extends Error {}
  return {
    getSession: () => session,
    setSession: (v: any) => { session = v; },
    FakeForbidden,
    requirePermission: vi.fn(async () => {}),
    getPermissionSummary: vi.fn(async () => ({ keys: ["calendar.work:view"] })),
    buildFeed: vi.fn(async () => ({ events: [], sources: [], staleSources: [], failedSources: [] })),
    createProviders: vi.fn(() => ({})),
  };
});

vi.mock("@/lib/auth", () => ({ auth: async () => h.getSession() }));
vi.mock("@/kernel/access", () => ({
  ForbiddenError: h.FakeForbidden,
  requirePermission: (...a: any[]) => h.requirePermission(...a),
  getPermissionSummary: (...a: any[]) => h.getPermissionSummary(...a),
}));
vi.mock("@/modules/calendar/feed", () => ({ buildFeed: (...a: any[]) => h.buildFeed(...a) }));
vi.mock("@/modules/calendar/providers", () => ({ createCalendarProviders: (...a: any[]) => h.createProviders(...a) }));

import { GET } from "@/app/api/calendar/feed/route";
import { POST } from "@/app/api/calendar/refresh/route";

const getReq = (qs: string) => new Request(`http://t/api/calendar/feed?${qs}`);
const postReq = (body: unknown) => new Request("http://t/api/calendar/refresh", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  h.setSession({ user: { id: "u1" } });
  h.requirePermission.mockReset().mockResolvedValue(undefined);
  h.getPermissionSummary.mockReset().mockResolvedValue({ keys: ["calendar.work:view"] });
  h.buildFeed.mockReset().mockResolvedValue({ events: [], sources: [], staleSources: [], failedSources: [] });
  h.createProviders.mockReset().mockReturnValue({});
});

describe("GET /api/calendar/feed", () => {
  it("미인증 → 401", async () => {
    h.setSession(null);
    expect((await GET(getReq("view=work&start=2026-06-15"))).status).toBe(401);
  });

  it("잘못된 view → 400", async () => {
    expect((await GET(getReq("view=nope&start=2026-06-15"))).status).toBe(400);
  });

  it("잘못된 start → 400", async () => {
    expect((await GET(getReq("view=work&start=not-a-date"))).status).toBe(400);
  });

  it("권한 없음 → 403", async () => {
    h.requirePermission.mockRejectedValue(new h.FakeForbidden("denied"));
    expect((await GET(getReq("view=work&start=2026-06-15"))).status).toBe(403);
  });

  it("창 밖 start(먼 과거) → 400", async () => {
    expect((await GET(getReq("view=work&start=1900-01-01"))).status).toBe(400);
  });

  it("성공 → 200, buildFeed에 정규화 range·ctx 전달, no-store", async () => {
    // 앵커는 now 기준 운영 창 안이어야 하므로 현재 시각으로 만든다(고정 날짜는 시간 경과 시 창을 벗어나 테스트가 깨짐).
    const res = await GET(getReq(`view=work&start=${new Date().toISOString()}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(h.requirePermission).toHaveBeenCalledWith("u1", "calendar.work", "view");
    const [view, range, ctx, providers] = h.buildFeed.mock.calls[0];
    expect(view).toBe("work");
    // 정규화 정확값은 time.test.ts가 검증 — 여기선 6주(42일) 그리드 불변식만 확인.
    expect((range.end.getTime() - range.start.getTime()) / 86_400_000).toBe(42);
    expect(ctx.userId).toBe("u1");
    expect(ctx.permissionKeys.has("calendar.work:view")).toBe(true);
    expect(h.createProviders).toHaveBeenCalledWith({ forceRefresh: false });
    expect(providers).toBeDefined();
  });
});

describe("POST /api/calendar/refresh", () => {
  it("미인증 → 401", async () => {
    h.setSession(null);
    expect((await POST(postReq({ view: "work", start: "2026-06-15" }))).status).toBe(401);
  });

  it("잘못된 view → 400", async () => {
    expect((await POST(postReq({ view: "nope", start: "2026-06-15" }))).status).toBe(400);
  });

  it("창 밖 start → 400", async () => {
    expect((await POST(postReq({ view: "leave", start: "1900-01-01" }))).status).toBe(400);
  });

  it("성공 → forceRefresh:true provider로 buildFeed, 200", async () => {
    const res = await POST(postReq({ view: "leave", start: new Date().toISOString() }));
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("u1", "calendar.leave", "view");
    expect(h.createProviders).toHaveBeenCalledWith({ forceRefresh: true });
  });
});
```

실행(FAIL): `npm test -- tests/app/api/calendar/feed.test.ts`

### 3. 라우트 구현 (PASS 확인)

`src/app/api/calendar/feed/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError, getPermissionSummary, requirePermission } from "@/kernel/access";
import { isViewKey, VIEW_PERMISSION } from "@/modules/calendar/views";
import { MAX_ANCHOR_MONTHS } from "@/modules/calendar/constants";
import { isAnchorWithinWindow, normalizeToGridWindow } from "@/modules/calendar/time";
import { buildFeed } from "@/modules/calendar/feed";
import { createCalendarProviders } from "@/modules/calendar/providers";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "";
  const start = url.searchParams.get("start") ?? "";
  if (!isViewKey(view)) return NextResponse.json({ error: "invalid view" }, { status: 400 });
  const anchor = new Date(start);
  if (Number.isNaN(anchor.getTime())) return NextResponse.json({ error: "invalid start" }, { status: 400 });
  // 앵커를 운영 창(now 기준 ±MAX_ANCHOR_MONTHS)으로 제한 — 무제한 달 열거로 인한 외부 호출·캐시 행 증가 차단(적대적 리뷰).
  if (!isAnchorWithinWindow(anchor, new Date(), MAX_ANCHOR_MONTHS)) return NextResponse.json({ error: "start out of allowed window" }, { status: 400 });

  try {
    await requirePermission(session.user.id, VIEW_PERMISSION[view], "view");
    const range = normalizeToGridWindow(anchor);
    const summary = await getPermissionSummary(session.user.id);
    const ctx = { userId: session.user.id, isOwner: false, permissionKeys: new Set(summary.keys) };
    const providers = createCalendarProviders({ forceRefresh: false });
    const feed = await buildFeed(view, range, ctx, providers);
    return NextResponse.json(feed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
```

`src/app/api/calendar/refresh/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError, getPermissionSummary, requirePermission } from "@/kernel/access";
import { isViewKey, VIEW_PERMISSION } from "@/modules/calendar/views";
import { MAX_ANCHOR_MONTHS } from "@/modules/calendar/constants";
import { isAnchorWithinWindow, normalizeToGridWindow } from "@/modules/calendar/time";
import { buildFeed } from "@/modules/calendar/feed";
import { createCalendarProviders } from "@/modules/calendar/providers";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const view = body?.view ?? "";
  const start = body?.start ?? "";
  if (!isViewKey(view)) return NextResponse.json({ error: "invalid view" }, { status: 400 });
  const anchor = new Date(start);
  if (Number.isNaN(anchor.getTime())) return NextResponse.json({ error: "invalid start" }, { status: 400 });
  // 앵커를 운영 창(now 기준 ±MAX_ANCHOR_MONTHS)으로 제한 — refresh는 forceRefresh라 무제한 달 열거 시 Google 강제 호출이 누적된다(적대적 리뷰).
  if (!isAnchorWithinWindow(anchor, new Date(), MAX_ANCHOR_MONTHS)) return NextResponse.json({ error: "start out of allowed window" }, { status: 400 });

  try {
    await requirePermission(session.user.id, VIEW_PERMISSION[view], "view");
    const range = normalizeToGridWindow(anchor);
    const summary = await getPermissionSummary(session.user.id);
    const ctx = { userId: session.user.id, isOwner: false, permissionKeys: new Set(summary.keys) };
    // forceRefresh: (view,range) 범위만 강제 재검증. 전역 캐시 무효화 아님. min-interval은 cache가 가드.
    const providers = createCalendarProviders({ forceRefresh: true });
    const feed = await buildFeed(view, range, ctx, providers);
    return NextResponse.json(feed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
```

실행(PASS): `npm test -- tests/app/api/calendar/feed.test.ts`

### 4. commit

```
git add src/modules/calendar/providers.ts src/app/api/calendar tests/app/api/calendar
git commit -m "calendar: add feed + refresh API routes (perm-gated, range-scoped refresh)"
```

## Acceptance Criteria

- `npm test -- tests/app/api/calendar/feed.test.ts` → PASS.
- `npm run typecheck` / `npm run lint` → OK(app은 module·kernel·lib import 허용).

## Cautions

- **refresh에 별도 권한 키를 추가하지 말 것.** 이유: §12.4 결정 — 사용자가 이미 보는 데이터의 재검증이라 `calendar.{view}:view`를 재사용한다(YAGNI). 전역 강제 갱신(admin)은 후속.
- **`ctx.isOwner`를 DB에서 또 조회하지 말 것.** 이유: PM/OWNER는 `getPermissionSummary`에 `calendar.admin:view`가 포함되어 masking이 이미 상세 노출로 처리한다. 추가 쿼리는 불필요(`isOwner:false`로 두어도 동일 결과).
- **응답에 `Cache-Control: no-store`를 빼지 말 것.** 이유: 마스킹된 권한별 응답이 캐시되면 다른 사용자에게 샐 수 있다(settings 라우트와 동일 규약).
- **`start` 앵커를 무제한 허용하지 말 것.** 이유: cache의 min-interval 가드는 (source,range)별이라 *서로 다른 달*을 열거하면 매번 cold-fetch가 일어나 Google 호출·`CalendarCacheEntry` 행이 무한 증가한다(적대적 리뷰). `isAnchorWithinWindow(anchor, new Date(), MAX_ANCHOR_MONTHS)`로 운영 창(±12개월) 밖이면 400(GET·POST 공통). 사용자별 rate-limit은 소규모 내부 도구라 보류(YAGNI) — 키 공간 제한이 1차 방어.
