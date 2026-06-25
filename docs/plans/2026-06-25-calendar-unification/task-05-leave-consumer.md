# Task 05 — 연차 소비처 (어댑터 + `leave-calendar` 재작성, 팝오버 신청)

연차 캘린더를 `CalendarMonth`(intensity=`soft`, 종류별 색, 팝오버 목록+신청, `canManage`면 빠른추가)로 재작성한다. 연차 진입점(`/leave/request?date=`·`+ 연차 입력`)을 팝오버/빠른추가로 흡수하되 `CreateLeaveModal`·제출 경로는 무변경(D11).

## Files

- **Create** `src/app/(app)/leave/_components/leave-adapter.ts` — `Ev` 타입 + `leaveToEvents`(순수).
- **Create (test)** `tests/app/leave/leave-adapter.test.ts`.
- **Modify (재작성)** `src/app/(app)/leave/_components/leave-calendar.tsx` — 자체 그리드/`colorFor`/`eventsOn`/`leadBlanks`/정적 색 범례/상단 `+ 연차 입력` 버튼 제거. `useRouter`는 **유지**(자가신청 라우트 보존, 아래 주의 참조).
- **Modify** `src/app/(app)/leave/calendar/page.tsx` — `LeaveCalendar`에 `canCreate`(자가신청 능력) prop 추가 전달.

## 두 진입 경로 분리 (review-loop R1 high — 필독)

연차 캘린더 in-cell 진입은 **서로 다른 두 능력·두 제출 경로**다. 절대 하나로 병합하지 말 것(이전 plan 초안의 결함):

| 경로 | 능력 게이트 | 제출 경로(무변경) | UI |
| --- | --- | --- | --- |
| **자가신청**(self-service, 본인 연차) | `canCreate` = `leave.request:create` | `router.push("/leave/request?date=")` (라우트 보존, 페이지가 create 권한 enforce) | 빠른추가 `+` + 팝오버 "이 날짜로 연차 신청" |
| **관리자 직접입력**(타인 연차) | `canManage` = `approvalScope === "all"` | `CreateLeaveModal` → `/api/admin/leave/requests` (무변경) | 팝오버 "관리자 직접 입력" |

D11("캘린더 내 진입만 바꾼다") = **두 경로를 그대로 팝오버/빠른추가로 옮기되 제출 경로는 불변**. 일반 사용자의 자가신청을 없애면 안 된다(기존 = 모든 캘린더 뷰어가 날짜 클릭→`/leave/request`).

## Prep

- 읽기: spec §4(어댑터 — 연차), D5(status 오버레이)·D8(팝오버)·D9(빠른추가)·D11(진입점 흡수)·D12(범례)·D14②(inclusive→half-open), entrypoint §Shared Contracts.
- 현재 파일: `src/app/(app)/leave/_components/leave-calendar.tsx`(react-query 패칭·cursor 월 네비·`canManage`는 유지). `Ev` 인터페이스는 이 파일에서 leave-adapter로 이동.
- 현재 페이지: `src/app/(app)/leave/calendar/page.tsx`(이미 `set`=권한키·`approvalScope` 계산 보유 → `canCreate` 한 줄 추가).
- 무변경: `create-leave-modal.tsx`(이미 `defaultDate?: string` 지원 — 트리거만 팝오버/+로), `labels.ts`, `/api/leave/calendar`(start/end 범위 제한 없음 — `parseLeaveDate`로 임의 범위 overlap 조회, 윈도우 확대 안전).
- §Shared Contracts items 사용: `CalendarEventInput`/`EventStatus`(task 01), `CalendarMonth`(task 03), `eventChipClass`(task 02), `allDayHalfOpen`/`normalizeToGridWindow`/`toKstDateKey`(`@/modules/calendar/time`, 기존), `getFullLeaveText`/`TYPE_LABEL`(`@/modules/leave/labels`, 기존).

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
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { normalizeToGridWindow, toKstDateKey } from "@/modules/calendar/time";
import { CalendarMonth } from "@/modules/calendar/ui/calendar-month";
import { eventChipClass } from "@/modules/calendar/ui/kind-styles";
import { TYPE_LABEL } from "@/modules/leave/labels";
import { CreateLeaveModal } from "./create-leave-modal";
import { leaveToEvents, type Ev } from "./leave-adapter";

export function LeaveCalendar({ canCreate, canManage }: { canCreate: boolean; canManage: boolean }) {
  const router = useRouter();
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getUTCFullYear(), m: today.getUTCMonth() }); // m: 0-based
  const [creating, setCreating] = useState<string | null>(null); // 관리자 직접입력 모달 defaultDate(null=닫힘)

  const anchor = new Date(Date.UTC(cursor.y, cursor.m, 15, 3, 0, 0));
  // 표시되는 42칸 그리드(인접월 포함) 전체를 패칭 — 보이는 셀에 데이터 누락(가짜 빈칸) 없도록. R1 medium.
  const { start: winStart, end: winEnd } = normalizeToGridWindow(anchor);
  const startKey = toKstDateKey(winStart);
  const endKey = toKstDateKey(new Date(winEnd.getTime() - 1)); // winEnd는 exclusive(+42일) → 마지막 점유 날

  const { data } = useQuery({
    queryKey: ["leave", "calendar", startKey, endKey],
    queryFn: async (): Promise<Ev[]> => {
      const res = await fetch(`/api/leave/calendar?start=${startKey}&end=${endKey}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`calendar ${res.status}`);
      return (await res.json()).events as Ev[];
    },
  });
  const events = leaveToEvents(data ?? []);

  const move = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.y, c.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

  // 빠른추가 + = 본인 자가신청(self-service). 라우트 보존(/leave/request 페이지가 create 권한 enforce).
  const quickAdd = canCreate ? (dateKey: string) => router.push(`/leave/request?date=${dateKey}`) : undefined;

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
        onQuickAdd={quickAdd}
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
            {(canCreate || canManage) && (
              <div className="flex flex-col gap-1">
                {canCreate && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      close();
                      router.push(`/leave/request?date=${dateKey}`);
                    }}
                  >
                    이 날짜로 연차 신청
                  </Button>
                )}
                {canManage && (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      close();
                      setCreating(dateKey);
                    }}
                  >
                    관리자 직접 입력
                  </Button>
                )}
              </div>
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

### Step 3b — `leave/calendar/page.tsx`에 `canCreate` 전달

`src/app/(app)/leave/calendar/page.tsx`의 마지막 줄만 수정(이미 `set`·`approvalScope` 계산 보유):

```tsx
  return <LeaveCalendar canCreate={set.has("leave.request:create")} canManage={approvalScope === "all"} />;
```

(나머지 — `leave.request:view` 게이트·`approvalScope` 계산 — 무변경.)

## Step 4 — 회귀 확인 + commit

```bash
npm run typecheck
npm run lint
npm test
npm run build
git add src/app/(app)/leave/_components/leave-adapter.ts tests/app/leave/leave-adapter.test.ts src/app/(app)/leave/_components/leave-calendar.tsx src/app/(app)/leave/calendar/page.tsx
git commit -m "feat(calendar): 연차 캘린더를 CalendarMonth로 재작성(soft·종류색·자가신청/관리자 진입 분리·그리드윈도우 패칭)"
```

## Acceptance Criteria

```bash
npm test -- tests/app/leave/leave-adapter.test.ts   # PASS
npm run typecheck   # 에러 0
npm run lint        # boundaries 통과
npm test            # 전체 그린(두 캘린더 어댑터·lanes·kind-styles·CalendarMonth)
npm run build       # 성공
```
- `leave-calendar.tsx`에서 `colorFor`·`eventsOn`·`leadBlanks`·`ymd`·정적 색 범례 Card·상단 `+ 연차 입력` 버튼이 사라졌다(단 `useRouter`는 자가신청 라우트용으로 **유지**).
- 자가신청(`canCreate`)은 `/leave/request?date=`로, 관리자 직접입력(`canManage`)은 `CreateLeaveModal`로 — **두 제출 경로 모두 diff 없음**(D10/D11). 일반 사용자(create 가능·approve-all 불가)도 캘린더에서 자가신청 진입이 유지된다.
- 연차 패칭이 **42칸 그리드 윈도우**(`normalizeToGridWindow`)로 확대됐다(인접월 가짜 빈칸 제거). `/api/leave/calendar` 라우트·service는 무변경.
- dev 배포 smoke(spec §10): 인증 후 `/calendar`·`/leave/calendar` 양쪽 렌더 + 팝오버 + **자가신청 1건**(일반 사용자 경로) + (가능 시) 관리자 직접입력 1건.

## Cautions

- **자가신청과 관리자 직접입력을 하나로 병합하지 말 것(R1 high).** 이유: 둘은 다른 능력(`canCreate` vs `canManage`)·다른 제출 경로(`/leave/request` 라우트 vs `CreateLeaveModal`→`/api/admin/leave/requests`)다. `canManage` 하나로 묶으면 일반 사용자(create 가능·approve-all 불가)의 캘린더 자가신청이 사라지는 **회귀**(기존엔 모든 뷰어가 날짜 클릭→`/leave/request`). 표 "두 진입 경로 분리" 참조.
- **`endDate`를 그대로 `end`에 넣지 말 것.** 이유: D14② — 연차 `endDate`는 inclusive 종료일. `allDayHalfOpen`로 변환하지 않으면 막대가 마지막 날 하루 모자란다(예: 6/1~6/3이 6/1~6/2로 표시). 이 task의 핵심 버그 지점.
- **신청 폼·검증·제출(`CreateLeaveModal` 내부 / `/leave/request` 페이지)을 건드리지 말 것.** 이유: D10/D11 — 진입(트리거)만 팝오버/빠른추가로 옮긴다. `CreateLeaveModal`은 이미 `defaultDate`를 받고, 자가신청은 기존 `?date=` 쿼리를 그대로 쓴다.
- **상단 `+ 연차 입력` 버튼을 남기지 말 것.** 이유: D11 — 진입점을 팝오버/빠른추가로 흡수. 자가신청은 셀 `+`(canCreate) 또는 팝오버 "연차 신청", 관리자 직접입력은 팝오버 "관리자 직접 입력"(canManage). (모바일은 hover 없으니 팝오버 버튼이 주 경로.)
- **상태를 색으로 되돌리지 말 것.** 이유: 기존 `colorFor`의 `PENDING=amber`·`반려=muted`는 D5로 폐기 — 종류는 색(soft), 상태는 오버레이. `colorFor` 부활 금지.
- **연차 fetch는 월(first~last)이 아니라 42칸 그리드 윈도우로(R1 medium).** 이유: `CalendarMonth`는 인접월 날짜를 **활성 클릭 가능 셀**로 렌더한다. 월만 패칭하면 그 셀들이 연차가 있어도 빈칸으로 보이는 **가짜 빈칸** 결함이 생긴다(기존은 인접월을 blank로 안 그렸음). `normalizeToGridWindow(anchor)` 범위를 `/api/leave/calendar`에 넘긴다(API 무변경, 범위만 확대).
