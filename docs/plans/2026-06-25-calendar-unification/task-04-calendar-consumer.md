# Task 04 — 통합 소비처 (feed 어댑터 + `calendar-view` 재작성)

통합 캘린더를 `CalendarMonth`(intensity=`bold`, 읽기전용 팝오버)로 재작성한다. feed→공통 모델 변환은 순수 어댑터로 분리해 단위 테스트한다. 데이터 패칭·뷰 탭·월 네비·stale/실패 표시는 유지.

## Files

- **Create** `src/app/(app)/calendar/feed-adapter.ts`.
- **Create (test)** `tests/app/calendar/feed-adapter.test.ts`.
- **Modify (재작성)** `src/app/(app)/calendar/calendar-view.tsx` — 인라인 그리드/`KIND_CLASS`/`WEEKDAYS`/`buildMonthGrid` 제거, `CalendarMonth` 사용.

## Prep

- 읽기: spec §4(어댑터 — 통합), D14①(feed passthrough), entrypoint §Shared Contracts(날짜 범위 계약·`CalendarMonth` 인터페이스).
- 현재 파일: `src/app/(app)/calendar/calendar-view.tsx`(react-query 패칭·뷰 탭·월 네비·refresh·stale/failed는 그대로 유지, 인라인 grid만 교체).
- §Shared Contracts items 사용: `CalendarEventInput`/`EventStatus`(task 01), `CalendarMonth`(task 03), `eventChipClass`(task 02), `CalEvent`/`FeedResponse`/`ViewKey`(`@/modules/calendar/types`, 기존).
- 테스트 import 경로 확인: `@/app/(app)/calendar/feed-adapter`는 vitest alias로 정상 해석(기존 `@/app/(app)/app-nav` 선례).

## Deps

- task 01, task 03 (transitively task 02).

## Step 1 — feed 어댑터 실패 테스트

`tests/app/calendar/feed-adapter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { feedToEvents } from "@/app/(app)/calendar/feed-adapter";
import { eventDayKeys } from "@/modules/calendar/ui/lanes";
import type { CalEvent } from "@/modules/calendar/types";

function cal(p: Partial<CalEvent>): CalEvent {
  return {
    id: "c", kind: "WORKFLOW_TASK", title: "t", description: null,
    start: "2026-06-01T00:00:00+09:00", end: "2026-06-04T00:00:00+09:00", // half-open: 06-01~03
    allDay: true, userId: null, sourceKey: "s", dedupStatus: "UNIQUE", masked: false, tentative: false, ...p,
  };
}

describe("feedToEvents (D14① passthrough)", () => {
  it("start/end 그대로 — half-open 점유 정확(06-01~03, 06-04 미점유)", () => {
    const [e] = feedToEvents([cal({})]);
    expect(eventDayKeys(e)).toEqual({ firstKey: "2026-06-01", lastKey: "2026-06-03" });
  });
  it("tentative → status PENDING, 아니면 null", () => {
    expect(feedToEvents([cal({ tentative: true })])[0].status).toBe("PENDING");
    expect(feedToEvents([cal({ tentative: false })])[0].status).toBeNull();
  });
  it("kind/title/id passthrough", () => {
    const [e] = feedToEvents([cal({ id: "x", kind: "HOLIDAY", title: "현충일" })]);
    expect([e.id, e.kind, e.title]).toEqual(["x", "HOLIDAY", "현충일"]);
  });
});
```

**Run (expect FAIL):**
```bash
npm test -- tests/app/calendar/feed-adapter.test.ts
```

## Step 2 — feed 어댑터 구현

`src/app/(app)/calendar/feed-adapter.ts`:

```ts
import type { CalEvent } from "@/modules/calendar/types";
import type { CalendarEventInput, EventStatus } from "@/modules/calendar/ui/event-input";

// 통합 feed의 CalEvent → 공통 모델. feed가 이미 half-open이라 start/end passthrough(D14①).
// tentative(미승인 잠정) → status PENDING(점선 오버레이). 그 외엔 status 없음(feed가 승인분만 합성).
export function feedToEvents(events: CalEvent[]): CalendarEventInput[] {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    kind: e.kind,
    start: e.start,
    end: e.end,
    status: e.tentative ? ("PENDING" as EventStatus) : null,
  }));
}
```

**Run (expect PASS):**
```bash
npm test -- tests/app/calendar/feed-adapter.test.ts
```

## Step 3 — `calendar-view.tsx` 재작성

전체 파일을 아래로 교체(인라인 grid·`KIND_CLASS`·`WEEKDAYS`·`buildMonthGrid` import 제거, 나머지 로직 유지):

```tsx
"use client";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedResponse, ViewKey } from "@/modules/calendar/types";
import { CalendarMonth } from "@/modules/calendar/ui/calendar-month";
import { eventChipClass } from "@/modules/calendar/ui/kind-styles";
import { Button } from "@/components/ui/button";
import { feedToEvents } from "./feed-adapter";

const VIEW_LABEL: Record<ViewKey, string> = { work: "업무", leave: "휴가", personal: "개인", team: "팀", admin: "관리자" };

// kind 표시명(범례·팝오버용).
const KIND_LABEL: Record<string, string> = {
  INTERNAL_LEAVE: "휴가",
  EXTERNAL_VACATION: "외부 휴가",
  WORKFLOW_TASK: "업무",
  HOLIDAY: "공휴일",
  EXTERNAL_EVENT: "외부 일정",
  PERSONAL_EVENT: "개인",
  TEAM_EVENT: "팀",
};

async function fetchFeed(view: ViewKey, anchorISO: string): Promise<FeedResponse> {
  const res = await fetch(`/api/calendar/feed?view=${view}&start=${encodeURIComponent(anchorISO)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  return res.json();
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
// 서버에 보내는 앵커: 표시 중인 연/월의 KST 정오(15일 12:00 KST = UTC 03:00)로 고정.
function monthAnchorISO(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 15, 3, 0, 0)).toISOString();
}

export function CalendarView({ allowedViews }: { allowedViews: ViewKey[] }) {
  const qc = useQueryClient();
  const [view, setView] = useState<ViewKey>(allowedViews[0] ?? "work");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const query = useQuery({
    queryKey: ["calendar", view, monthKey(anchor)],
    queryFn: () => fetchFeed(view, monthAnchorISO(anchor)),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    for (const delta of [-1, 1]) {
      const adj = addMonths(anchor, delta);
      void qc.prefetchQuery({ queryKey: ["calendar", view, monthKey(adj)], queryFn: () => fetchFeed(view, monthAnchorISO(adj)) });
    }
  }, [view, anchor, qc]);

  async function refresh() {
    setRefreshing(true);
    try {
      await fetch("/api/calendar/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view, start: monthAnchorISO(anchor) }),
      });
      await qc.invalidateQueries({ queryKey: ["calendar", view, monthKey(anchor)] });
    } finally {
      setRefreshing(false);
    }
  }

  const feed = query.data;
  const events = feed ? feedToEvents(feed.events) : [];

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
          <Button size="sm" variant="outline" onClick={refresh} disabled={query.isFetching || refreshing}>새로고침</Button>
        </div>
      </div>

      {feed && (feed.staleSources.length > 0 || feed.failedSources.length > 0) && (
        <p className="text-xs text-muted-foreground">
          {feed.failedSources.length > 0 && <span className="text-destructive">실패: {feed.failedSources.join(", ")} </span>}
          {feed.staleSources.length > 0 && <span>· 이전 데이터 표시: {feed.staleSources.join(", ")}</span>}
        </p>
      )}

      <CalendarMonth
        anchor={anchor}
        events={events}
        intensity="bold"
        legend
        legendLabel={(k) => KIND_LABEL[k] ?? k}
        renderDayDetail={({ events: dayEvents }) => (
          <ul className="space-y-1">
            {dayEvents.length === 0 && <li className="text-muted-foreground">일정 없음</li>}
            {dayEvents.map((e) => (
              <li
                key={e.id}
                className={`truncate rounded px-1.5 py-0.5 text-xs ${eventChipClass(e.kind, "soft", e.status)}`}
                title={e.title}
              >
                {e.title}
              </li>
            ))}
          </ul>
        )}
      />

      {query.isError && <p className="text-sm text-destructive">캘린더를 불러오지 못했습니다.</p>}
    </div>
  );
}
```

## Step 4 — 회귀 확인 + commit

```bash
npm run typecheck
npm run lint
npm test
npm run build
git add src/app/(app)/calendar/feed-adapter.ts tests/app/calendar/feed-adapter.test.ts src/app/(app)/calendar/calendar-view.tsx
git commit -m "feat(calendar): 통합 캘린더를 CalendarMonth로 재작성(bold·읽기전용 팝오버·feed 어댑터)"
```

## Acceptance Criteria

```bash
npm test -- tests/app/calendar/feed-adapter.test.ts   # PASS
npm run typecheck   # 에러 0
npm run lint        # boundaries 통과(app→module/ui 허용)
npm run build       # 성공(Tailwind 클래스 purge 확인)
```
- `calendar-view.tsx`에서 인라인 grid·`KIND_CLASS`·`WEEKDAYS`·`buildMonthGrid` import가 사라졌다.
- feed/refresh fetch URL·payload·queryKey는 변경 없음(서버 무변경 D10).

## Cautions

- **feed fetch·refresh·뷰 탭·prefetch·stale/failed 표시 로직을 바꾸지 말 것.** 이유: D10 — 표현 계층만 교체. `queryKey`/URL/payload가 바뀌면 캐시·서버 계약이 흔들린다. grid 렌더만 `CalendarMonth`로 교체.
- **`end`를 가공하지 말 것.** 이유: feed는 이미 half-open(D14①) → passthrough. 변환하면 막대 길이가 어긋난다.
- **읽기전용 유지(`onQuickAdd` 미주입).** 이유: 통합 캘린더는 신청 진입이 없다(연차만). `+` 없음.
