# Task 11 — UI: React Query + 월 그리드 3뷰

`@tanstack/react-query` 도입(§13.1), `(app)` QueryProvider, 커스텀 월 그리드 + 뷰 탭(권한 있는 탭만) + 월 이동(인접 월 prefetch) + 수동 새로고침 + 소스별 stale/failed 배지. **순수 그리드 빌더만 node 단위 테스트**하고, React 렌더링은 typecheck/lint/build + 수동(Playwright) 확인한다(프로젝트에 jsdom 셋업 없음).

## Files

- Modify: `package.json` (`@tanstack/react-query` 추가)
- Create: `src/modules/calendar/ui/grid.ts` (순수 — 테스트 대상)
- Create: `src/app/(app)/providers.tsx` (QueryClientProvider)
- Modify: `src/app/(app)/layout.tsx` (Providers로 감싸기)
- Create: `src/app/(app)/calendar/calendar-view.tsx` (client)
- Modify: `src/app/(app)/calendar/page.tsx` (allowedViews 계산 → client view)
- Test: `tests/modules/calendar/grid.test.ts`

## Prep

- Spec §13/§13.1. 엔트리포인트 §Shared Contracts: `CalEvent`, `FeedResponse`, `ViewKey`, `UI_VIEWS`, `VIEW_PERMISSION`, time `normalizeToGridWindow`/`toKstDateKey`.
- 현재 `(app)/layout.tsx`는 `PermissionProvider`로 감싸고 `getPermissionSummary`를 이미 호출한다.

## Deps

01(types/time/views), 09(feed API).

## Steps

### 1. 의존성 추가

```
npm install @tanstack/react-query
```

`package.json` dependencies에 `@tanstack/react-query`(^5) 추가 확인.

### 2. 그리드 빌더 테스트 먼저 (FAIL 확인)

`tests/modules/calendar/grid.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildMonthGrid } from "@/modules/calendar/ui/grid";
import type { CalEvent } from "@/modules/calendar/types";

function evt(p: Partial<CalEvent>): CalEvent {
  return {
    id: "e", kind: "WORKFLOW_TASK", title: "주간보고", description: null,
    start: "2026-06-11T15:00:00.000Z", end: "2026-06-12T15:00:00.000Z", // 06-12 KST all-day
    allDay: true, userId: null, sourceKey: "workflowTask", dedupStatus: "UNIQUE", masked: false, ...p,
  };
}

describe("buildMonthGrid", () => {
  it("6주(42칸) 생성, 첫 칸은 2026-05-31(일), 달력 외 날짜는 inMonth=false", () => {
    const grid = buildMonthGrid(new Date("2026-06-15T03:00:00+09:00"), []);
    expect(grid).toHaveLength(42);
    expect(grid[0].dateKey).toBe("2026-05-31");
    expect(grid[0].inMonth).toBe(false);
    expect(grid.find((d) => d.dateKey === "2026-06-01")!.inMonth).toBe(true);
    expect(grid.find((d) => d.dateKey === "2026-06-15")!.inMonth).toBe(true);
  });

  it("이벤트가 겹치는 KST 날짜 칸에 배치", () => {
    const grid = buildMonthGrid(new Date("2026-06-15T03:00:00+09:00"), [evt({ id: "w1" })]);
    const day12 = grid.find((d) => d.dateKey === "2026-06-12")!;
    expect(day12.events.map((e) => e.id)).toEqual(["w1"]);
    const day13 = grid.find((d) => d.dateKey === "2026-06-13")!;
    expect(day13.events).toHaveLength(0);
  });

  it("여러 날 걸친 이벤트는 각 날짜에 모두 배치", () => {
    const multi = evt({ id: "m1", start: "2026-06-09T15:00:00.000Z", end: "2026-06-11T15:00:00.000Z" }); // 06-10~06-11 KST
    const grid = buildMonthGrid(new Date("2026-06-15T03:00:00+09:00"), [multi]);
    expect(grid.find((d) => d.dateKey === "2026-06-10")!.events).toHaveLength(1);
    expect(grid.find((d) => d.dateKey === "2026-06-11")!.events).toHaveLength(1);
    expect(grid.find((d) => d.dateKey === "2026-06-12")!.events).toHaveLength(0);
  });
});
```

실행(FAIL): `npm test -- tests/modules/calendar/grid.test.ts`

### 3. 그리드 빌더 구현 (PASS 확인)

`src/modules/calendar/ui/grid.ts`:

```ts
import { normalizeToGridWindow, toKstDateKey } from "../time";
import type { CalEvent } from "../types";

const MS_PER_DAY = 86_400_000;

export interface GridDay {
  dateKey: string; // 'YYYY-MM-DD' (KST)
  iso: string; // 그 날 00:00 KST의 UTC instant
  inMonth: boolean;
  events: CalEvent[];
}

export function buildMonthGrid(anchor: Date, events: CalEvent[]): GridDay[] {
  const { start } = normalizeToGridWindow(anchor);
  const anchorMonth = toKstDateKey(anchor).slice(0, 7);
  const days: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const dayStart = new Date(start.getTime() + i * MS_PER_DAY);
    const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);
    const dayEvents = events.filter((e) => {
      const s = new Date(e.start).getTime();
      const en = new Date(e.end).getTime();
      return s < dayEnd.getTime() && dayStart.getTime() < en;
    });
    const dateKey = toKstDateKey(dayStart);
    days.push({ dateKey, iso: dayStart.toISOString(), inMonth: dateKey.slice(0, 7) === anchorMonth, events: dayEvents });
  }
  return days;
}
```

실행(PASS): `npm test -- tests/modules/calendar/grid.test.ts`

### 4. QueryClientProvider

`src/app/(app)/providers.tsx`:

```tsx
"use client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function Providers({ children }: { children: React.ReactNode }) {
  // QueryClient는 Provider 내부 state로 생성(요청 간 캐시 누수 방지).
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

### 5. layout.tsx에 Providers 추가

`src/app/(app)/layout.tsx` 수정:

- import 추가: `import { Providers } from "./providers";`
- 반환 트리에서 `PermissionProvider` 바로 안쪽을 `Providers`로 감싼다:

```tsx
  return (
    <PermissionProvider keys={summary.keys}>
      <Providers>
        <div className="grid min-h-screen grid-cols-[200px_1fr]">
          {/* ...기존 내용 그대로... */}
        </div>
      </Providers>
    </PermissionProvider>
  );
```

(기존 `<div>…</div>` 블록은 변경 없이 `<Providers>`로 감싸기만 한다.)

### 6. 캘린더 클라이언트 뷰

`src/app/(app)/calendar/calendar-view.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildMonthGrid } from "@/modules/calendar/ui/grid";
import type { FeedResponse, ViewKey } from "@/modules/calendar/types";
import { Button } from "@/components/ui/button";

const VIEW_LABEL: Record<ViewKey, string> = { work: "업무", leave: "휴가", personal: "개인", team: "팀", admin: "관리자" };
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

async function fetchFeed(view: ViewKey, anchorISO: string): Promise<FeedResponse> {
  const res = await fetch(`/api/calendar/feed?view=${view}&start=${encodeURIComponent(anchorISO)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  return res.json();
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`;
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function CalendarView({ allowedViews }: { allowedViews: ViewKey[] }) {
  const qc = useQueryClient();
  const [view, setView] = useState<ViewKey>(allowedViews[0] ?? "work");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const anchorISO = anchor.toISOString();

  const query = useQuery({
    queryKey: ["calendar", view, monthKey(anchor)],
    queryFn: () => fetchFeed(view, anchorISO),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    for (const delta of [-1, 1]) {
      const adj = addMonths(anchor, delta);
      void qc.prefetchQuery({ queryKey: ["calendar", view, monthKey(adj)], queryFn: () => fetchFeed(view, adj.toISOString()) });
    }
  }, [view, anchor, qc]);

  async function refresh() {
    await fetch("/api/calendar/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view, start: anchorISO }),
    });
    await qc.invalidateQueries({ queryKey: ["calendar", view, monthKey(anchor)] });
  }

  const feed = query.data;
  const grid = feed ? buildMonthGrid(anchor, feed.events) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {allowedViews.map((v) => (
          <Button key={v} size="sm" variant={v === view ? "default" : "ghost"} onClick={() => setView(v)}>
            {VIEW_LABEL[v]}
          </Button>
        ))}
        <span className="ml-2 font-display text-lg font-semibold">
          {anchor.getFullYear()}년 {anchor.getMonth() + 1}월
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setAnchor((a) => addMonths(a, -1))}>이전</Button>
          <Button size="sm" variant="ghost" onClick={() => setAnchor(new Date())}>오늘</Button>
          <Button size="sm" variant="ghost" onClick={() => setAnchor((a) => addMonths(a, 1))}>다음</Button>
          <Button size="sm" variant="outline" onClick={refresh} disabled={query.isFetching}>새로고침</Button>
        </div>
      </div>

      {feed && (feed.staleSources.length > 0 || feed.failedSources.length > 0) && (
        <p className="text-xs text-muted-foreground">
          {feed.failedSources.length > 0 && <span className="text-destructive">실패: {feed.failedSources.join(", ")} </span>}
          {feed.staleSources.length > 0 && <span>· 이전 데이터 표시: {feed.staleSources.join(", ")}</span>}
        </p>
      )}

      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-border">
        {WEEKDAYS.map((w) => (
          <div key={w} className="border-b border-border bg-card p-2 text-center text-xs font-medium text-muted-foreground">{w}</div>
        ))}
        {grid.map((day) => (
          <div key={day.dateKey} className={`min-h-24 border-b border-r border-border p-1 ${day.inMonth ? "" : "bg-muted/30 text-muted-foreground"}`}>
            <div className="text-xs">{Number(day.dateKey.slice(-2))}</div>
            <div className="mt-1 space-y-0.5">
              {day.events.map((e) => (
                <div key={e.id} className="truncate rounded bg-accent px-1 py-0.5 text-[11px]" title={e.masked ? e.title : e.title}>
                  {e.title}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {query.isError && <p className="text-sm text-destructive">캘린더를 불러오지 못했습니다.</p>}
    </div>
  );
}
```

### 7. page.tsx — allowedViews 계산

`src/app/(app)/calendar/page.tsx` 전체 교체:

```tsx
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { UI_VIEWS, VIEW_PERMISSION } from "@/modules/calendar/views";
import type { ViewKey } from "@/modules/calendar/types";
import { CalendarView } from "./calendar-view";

export default async function CalendarPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const keySet = new Set(keys);
  const allowedViews: ViewKey[] = UI_VIEWS.filter((v) => keySet.has(`${VIEW_PERMISSION[v]}:view`));

  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">캘린더</h1>
      {allowedViews.length === 0 ? (
        <p className="text-sm text-muted-foreground">표시할 캘린더 권한이 없습니다.</p>
      ) : (
        <CalendarView allowedViews={allowedViews} />
      )}
    </section>
  );
}
```

### 8. commit

```
git add package.json package-lock.json src/modules/calendar/ui src/app/\(app\)/providers.tsx src/app/\(app\)/layout.tsx src/app/\(app\)/calendar tests/modules/calendar/grid.test.ts
git commit -m "calendar: add React Query provider + custom month-grid UI (work/leave/personal)"
```

## Acceptance Criteria

- `npm test -- tests/modules/calendar/grid.test.ts` → PASS.
- `npm run typecheck` → 에러 없음(react-query 타입 포함).
- `npm run lint` → boundaries/react-hooks 위반 없음.
- `npm run build` → 성공(클라이언트 번들에 server-only 누수 없음).
- (수동) dev에서 `/calendar` 진입 → 뷰 탭·월 그리드·이벤트 칩·월 이동·새로고침·stale/failed 배지 동작. Playwright로 스크린샷 확인.

## Cautions

- **`calendar-view.tsx`에서 `@/modules/calendar/feed`나 provider·repository·google를 import하지 말 것.** 이유: 이들은 server-only(prisma·googleapis)를 끌어와 클라이언트 번들·빌드를 깬다. 클라이언트는 오직 `fetch('/api/calendar/feed')` + 순수 `buildMonthGrid`만 쓴다.
- **QueryClient를 모듈 전역으로 생성하지 말 것.** 이유: 서버에서 요청 간 캐시가 공유돼 사용자 간 데이터가 샌다. 반드시 Provider 내부 `useState(() => new QueryClient())`.
- **`prefetchQuery`를 렌더 본문에서 호출하지 말 것.** 이유: 렌더마다 부수효과가 발생한다. `useEffect`로 [view, anchor] 변화에만 prefetch.
- **마스킹을 클라이언트에서 풀려고 하지 말 것.** 이유: 서버가 이미 마스킹한 `CalEvent`만 온다. `masked` 플래그는 표시 스타일에만 쓴다(데이터 복원 불가·불필요).
