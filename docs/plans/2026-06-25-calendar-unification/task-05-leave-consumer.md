# Task 05 — 연차 소비처 (어댑터 + `leave-calendar` 재작성, 팝오버 신청)

연차 캘린더를 `CalendarMonth`(intensity=`soft`, 종류별 색, 팝오버 목록+신청, `canManage`면 빠른추가)로 재작성한다. 연차 진입점(`/leave/request?date=`·`+ 연차 입력`)을 팝오버/빠른추가로 흡수하되 `CreateLeaveModal`·제출 경로는 무변경(D11).

## Files

- **Create** `src/app/(app)/leave/_components/leave-adapter.ts` — `Ev` 타입 + `leaveToEvents`(순수).
- **Create (test)** `tests/app/leave/leave-adapter.test.ts`.
- **Modify (재작성)** `src/app/(app)/leave/_components/leave-calendar.tsx` — 자체 그리드/`colorFor`/`eventsOn`/`leadBlanks`/정적 색 범례/상단 `+ 연차 입력` 버튼/`useRouter` 제거.

## Prep

- 읽기: spec §4(어댑터 — 연차), D5(status 오버레이)·D8(팝오버)·D9(빠른추가)·D11(진입점 흡수)·D12(범례)·D14②(inclusive→half-open), entrypoint §Shared Contracts.
- 현재 파일: `src/app/(app)/leave/_components/leave-calendar.tsx`(react-query 패칭·cursor 월 네비·`canManage`는 유지). `Ev` 인터페이스는 이 파일에서 leave-adapter로 이동.
- 무변경: `create-leave-modal.tsx`(이미 `defaultDate?: string` 지원 — 트리거만 팝오버/+로), `labels.ts`, `/api/leave/calendar`.
- §Shared Contracts items 사용: `CalendarEventInput`/`EventStatus`(task 01), `CalendarMonth`(task 03), `eventChipClass`(task 02), `allDayHalfOpen`(`@/modules/calendar/time`, 기존), `getFullLeaveText`/`TYPE_LABEL`(`@/modules/leave/labels`, 기존).

## Deps

- task 01, task 03 (transitively task 02).

## Step 1 — 연차 어댑터 실패 테스트

`tests/app/leave/leave-adapter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { leaveToEvents, type Ev } from "@/app/(app)/leave/_components/leave-adapter";
import { eventDayKeys } from "@/modules/calendar/ui/lanes";

function lv(p: Partial<Ev>): Ev {
  return {
    id: "l", userId: "u", name: "홍길동", leaveType: "ANNUAL",
    leaveSubType: null, quarterStartTime: null,
    startDate: "2026-06-01T00:00:00.000Z", endDate: "2026-06-03T00:00:00.000Z",
    status: "APPROVED", isSelf: true, ...p,
  };
}

describe("leaveToEvents (D14② inclusive→half-open)", () => {
  it("inclusive 6/1~6/3 → 정확히 3일 점유(하루 모자람 없음)", () => {
    const [e] = leaveToEvents([lv({})]);
    expect(eventDayKeys(e)).toEqual({ firstKey: "2026-06-01", lastKey: "2026-06-03" });
  });
  it("단일일(반차, start=end) → 1일 점유", () => {
    const [e] = leaveToEvents([
      lv({ leaveType: "HALF", leaveSubType: "MORNING", startDate: "2026-06-05T00:00:00.000Z", endDate: "2026-06-05T00:00:00.000Z" }),
    ]);
    expect(eventDayKeys(e)).toEqual({ firstKey: "2026-06-05", lastKey: "2026-06-05" });
  });
  it("kind=leaveType, status 그대로, title=이름+휴가텍스트", () => {
    const [e] = leaveToEvents([lv({ name: "김철수", leaveType: "QUARTER", quarterStartTime: "09:00", status: "PENDING" })]);
    expect(e.kind).toBe("QUARTER");
    expect(e.status).toBe("PENDING");
    expect(e.title).toContain("김철수");
    expect(e.title).toContain("반반차");
  });
});
```

**Run (expect FAIL):**
```bash
npm test -- tests/app/leave/leave-adapter.test.ts
```

## Step 2 — 연차 어댑터 구현

`src/app/(app)/leave/_components/leave-adapter.ts`:

```ts
import { allDayHalfOpen } from "@/modules/calendar/time";
import { getFullLeaveText } from "@/modules/leave/labels";
import type { CalendarEventInput, EventStatus } from "@/modules/calendar/ui/event-input";

// 연차 캘린더 API(/api/leave/calendar) 응답 1건. (기존 leave-calendar.tsx의 Ev에서 이동)
export interface Ev {
  id: string;
  userId: string;
  name: string;
  leaveType: string;
  leaveSubType: string | null;
  quarterStartTime: string | null;
  startDate: string;
  endDate: string;
  status: string;
  isSelf: boolean;
}

// 연차 Ev → 공통 모델. endDate가 inclusive 종료일이라 allDayHalfOpen으로 half-open 변환(D14②).
// kind = leaveType(종류색, soft), status = 그대로(오버레이), title = 이름 + 전체 휴가 텍스트.
export function leaveToEvents(evs: Ev[]): CalendarEventInput[] {
  return evs.map((e) => {
    const { start, end } = allDayHalfOpen(new Date(e.startDate), new Date(e.endDate));
    return {
      id: e.id,
      title: `${e.name} ${getFullLeaveText(e.leaveType, e.leaveSubType, e.quarterStartTime)}`,
      kind: e.leaveType,
      start: start.toISOString(),
      end: end.toISOString(),
      status: e.status as EventStatus,
    };
  });
}
```

**Run (expect PASS):**
```bash
npm test -- tests/app/leave/leave-adapter.test.ts
```

## Step 3 — `leave-calendar.tsx` 재작성

전체 파일을 아래로 교체:

```tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CalendarMonth } from "@/modules/calendar/ui/calendar-month";
import { eventChipClass } from "@/modules/calendar/ui/kind-styles";
import { TYPE_LABEL } from "@/modules/leave/labels";
import { CreateLeaveModal } from "./create-leave-modal";
import { leaveToEvents, type Ev } from "./leave-adapter";

const ymd = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

export function LeaveCalendar({ canManage }: { canManage: boolean }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getUTCFullYear(), m: today.getUTCMonth() }); // m: 0-based
  const [creating, setCreating] = useState<string | null>(null); // 신청 모달 defaultDate(null=닫힘)

  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const last = new Date(Date.UTC(cursor.y, cursor.m + 1, 0));
  const { data } = useQuery({
    queryKey: ["leave", "calendar", cursor.y, cursor.m],
    queryFn: async (): Promise<Ev[]> => {
      const res = await fetch(`/api/leave/calendar?start=${ymd(first)}&end=${ymd(last)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`calendar ${res.status}`);
      return (await res.json()).events as Ev[];
    },
  });
  const events = leaveToEvents(data ?? []);
  const anchor = new Date(Date.UTC(cursor.y, cursor.m, 15, 3, 0, 0));

  const move = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.y, c.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => move(-1)}>이전</Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCursor({ y: today.getUTCFullYear(), m: today.getUTCMonth() })}
        >
          오늘
        </Button>
        <Button size="sm" variant="outline" onClick={() => move(1)}>다음</Button>
        <span className="font-medium">
          {cursor.y}년 {cursor.m + 1}월
        </span>
      </div>

      <CalendarMonth
        anchor={anchor}
        events={events}
        intensity="soft"
        legend
        legendLabel={(k) => TYPE_LABEL[k] ?? k}
        onQuickAdd={canManage ? (dateKey) => setCreating(dateKey) : undefined}
        renderDayDetail={({ dateKey, events: dayEvents, close }) => (
          <div className="space-y-2">
            <ul className="space-y-1">
              {dayEvents.length === 0 && <li className="text-muted-foreground">연차 없음</li>}
              {dayEvents.map((e) => (
                <li
                  key={e.id}
                  className={cn("truncate rounded px-1.5 py-0.5 text-xs", eventChipClass(e.kind, "soft", e.status))}
                  title={e.title}
                >
                  {e.title}
                </li>
              ))}
            </ul>
            {canManage && (
              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  close();
                  setCreating(dateKey);
                }}
              >
                + 이 날짜로 연차 입력
              </Button>
            )}
          </div>
        )}
      />

      {/* 상태 오버레이 키(정적 — 종류는 위 범례 토글, 상태는 오버레이로 표현; D5/D12) */}
      <Card className="flex flex-wrap items-center gap-4 p-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded border border-dashed border-current" /> 대기(점선)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="line-through">반려/취소</span> (취소선)
        </span>
      </Card>

      {creating !== null && (
        <CreateLeaveModal defaultDate={creating || undefined} onClose={() => setCreating(null)} />
      )}
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
git add src/app/(app)/leave/_components/leave-adapter.ts tests/app/leave/leave-adapter.test.ts src/app/(app)/leave/_components/leave-calendar.tsx
git commit -m "feat(calendar): 연차 캘린더를 CalendarMonth로 재작성(soft·종류색·팝오버 신청·빠른추가)"
```

## Acceptance Criteria

```bash
npm test -- tests/app/leave/leave-adapter.test.ts   # PASS
npm run typecheck   # 에러 0
npm run lint        # boundaries 통과
npm test            # 전체 그린(두 캘린더 어댑터·lanes·kind-styles·CalendarMonth)
npm run build       # 성공
```
- `leave-calendar.tsx`에서 `colorFor`·`eventsOn`·`leadBlanks`·정적 색 범례 Card·상단 `+ 연차 입력` 버튼·`useRouter` import가 사라졌다.
- `CreateLeaveModal`·`/api/leave/calendar`·연차 제출 경로는 diff 없음(D10/D11).
- dev 배포 smoke(spec §10): 인증 후 `/calendar`·`/leave/calendar` 양쪽 렌더 + 팝오버 + 연차 신청 1건.

## Cautions

- **`endDate`를 그대로 `end`에 넣지 말 것.** 이유: D14② — 연차 `endDate`는 inclusive 종료일. `allDayHalfOpen`로 변환하지 않으면 막대가 마지막 날 하루 모자란다(예: 6/1~6/3이 6/1~6/2로 표시). 이 task의 핵심 버그 지점.
- **신청 폼·검증·제출(`CreateLeaveModal` 내부)을 건드리지 말 것.** 이유: D10/D11 — 진입(트리거)만 팝오버/빠른추가로 옮긴다. `CreateLeaveModal`은 이미 `defaultDate`를 받으므로 호출만 바꾼다.
- **상단 `+ 연차 입력` 버튼을 남기지 말 것.** 이유: D11 — 진입점을 팝오버/빠른추가로 흡수. 신청은 셀 `+`(hover/터치 시 팝오버 버튼) 또는 팝오버 내 버튼으로. (모바일은 hover가 없으니 팝오버 버튼이 주 경로 — `canManage`면 항상 노출.)
- **상태를 색으로 되돌리지 말 것.** 이유: 기존 `colorFor`의 `PENDING=amber`·`반려=muted`는 D5로 폐기 — 종류는 색(soft), 상태는 오버레이. `colorFor` 부활 금지.
- **연차 fetch 범위(월 단위 first~last)는 유지.** 이유: surgical — 서버 계약·queryKey 무변경. 그리드의 인접월 칸은 비어 보이며(기존도 인접월 미표시), 회귀 아님.
