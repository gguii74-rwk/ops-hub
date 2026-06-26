# Task 06 — 컴포넌트(직무 버튼·정적 범례·공휴일 병합·미동기화 안내·nav 우측)

**목적:** `LeaveCalendar`에 직무 필터 버튼(fetch 쿼리의 일부), 변형 A 정적 범례, 공휴일 병합(`holidaysToEvents`), 미동기화 인라인 안내(`unsyncedYears`)를 추가하고, 툴바를 좌=직무·우=nav로 재배치한다. `CalendarMonth`의 kind 토글 범례를 끈다(D3).

## Files

- Modify: `src/app/(app)/leave/_components/leave-calendar.tsx`
- Test: `tests/app/leave/leave-calendar.test.tsx`

## Prep

- spec §3.5 / §3.7 / §5(컴포넌트) 읽기. 엔트리포인트 §Shared Contracts **S1·S4·S6·S7** 사용.
- 의존: task-03(응답 `{events,holidays,unsyncedYears}`), task-04(`holidaysToEvents`), task-05(`kindClass` soft 700).
- **테스트 경계:** 이 파일의 vitest는 `@tanstack/react-query`를 완전 모킹하므로 `job`→서버 왕복·실제 필터링은 검증하지 않는다(그건 task-02 서비스·task-03 라우트 테스트가 담당). 여기선 **렌더·상호작용**(버튼 렌더/pressed 토글·정적 범례·미동기화 안내·nav)만 검증한다.

## Deps

- task-03, task-04, task-05.

## TDD steps

### Step 1 — 실패 테스트 추가(react-query 모킹을 가변 데이터로 전환 + 신규 케이스)

`tests/app/leave/leave-calendar.test.tsx`를 수정한다.

(a) 상단 모킹을 hoisted 가변 `queryData`로 교체한다(기존 `vi.mock("@tanstack/react-query", ...)` 블록 대체). import에 `beforeEach` 추가:

```ts
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// react-query 모킹: useQuery 데이터를 가변 queryData로(테스트가 holidays/unsyncedYears를 주입).
const h = vi.hoisted(() => ({
  queryData: { events: [] as unknown[], holidays: [] as unknown[], unsyncedYears: [] as number[] },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: h.queryData }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));

import { LeaveCalendar } from "@/app/(app)/leave/_components/leave-calendar";

beforeEach(() => {
  h.queryData = { events: [], holidays: [], unsyncedYears: [] };
});
afterEach(() => {
  cleanup();
});
```

(b) 기존 4개 케이스(능력별 진입 분리)는 **그대로 둔다**(events 미사용이라 빈 객체로도 통과).

(c) 파일 끝에 신규 describe 블록을 추가한다:

```ts
describe("LeaveCalendar — 직무 필터·범례·공휴일 안내(D2/D3/D4/D9)", () => {
  it("직무 버튼 4개(전체/개발/민원/콘텐츠) + 기본 '전체' 선택", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    for (const label of ["전체", "개발", "민원", "콘텐츠"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "개발" })).toHaveAttribute("aria-pressed", "false");
  });

  it("직무 버튼 클릭 시 선택(aria-pressed) 전환", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    fireEvent.click(screen.getByRole("button", { name: "개발" }));
    expect(screen.getByRole("button", { name: "개발" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "false");
  });

  it("nav(이전/오늘/다음) 버튼 존재", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    for (const label of ["이전", "오늘", "다음"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("변형 A 정적 범례 칩(공휴일/연차/반차/반반차/대기중/반려·취소) 표시", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    for (const t of ["공휴일", "연차", "반차", "반반차", "대기중", "반려/취소"]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
  });

  it("unsyncedYears 비어있지 않으면 인라인 안내 표시", () => {
    h.queryData = { events: [], holidays: [], unsyncedYears: [2027] };
    render(<LeaveCalendar canCreate canManage={false} />);
    expect(screen.getByText(/2027년 공휴일 정보를 불러오지 못했습니다/)).toBeTruthy();
  });

  it("unsyncedYears 비었으면 안내 미표시", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    expect(screen.queryByText(/공휴일 정보를 불러오지 못했습니다/)).toBeNull();
  });
});
```

> `toHaveAttribute`/`toBeTruthy`는 기존 스위트가 쓰는 jest-dom 매처(setup에서 로드됨). "반차"는 정적 범례 칩 텍스트가 정확히 "반차"라 "반반차"와 충돌하지 않는다(getByText 정확 일치).

### Step 2 — 실행(FAIL 확인)

```bash
npm test -- tests/app/leave/leave-calendar.test.tsx
```

기대: 직무 버튼/정적 범례/미동기화 안내 신규 케이스 FAIL.

### Step 3 — 구현

`src/app/(app)/leave/_components/leave-calendar.tsx` **전체 교체**:

```tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobFunction } from "@/lib/auth/types";
import { normalizeToGridWindow, toKstDateKey } from "@/modules/calendar/time";
import { CalendarMonth } from "@/modules/calendar/ui/calendar-month";
import { eventChipClass, kindClass } from "@/modules/calendar/ui/kind-styles";
import { CreateLeaveModal } from "./create-leave-modal";
import { RequestLeaveModal } from "./request-leave-modal";
import { leaveToEvents, holidaysToEvents, type Ev } from "./leave-adapter";

// 직무 필터 버튼(고정 4개, PM 제외 — D2). admin JOB_LABEL은 admin 전용 private 영역이라 import하지 않고 인라인.
const JOB_FILTERS: { value: "ALL" | JobFunction; label: string }[] = [
  { value: "ALL", label: "전체" },
  { value: "DEVELOPER", label: "개발" },
  { value: "CIVIL_RESPONSE", label: "민원" },
  { value: "CONTENT_MANAGER", label: "콘텐츠" },
];

interface CalendarResponse {
  events: Ev[];
  holidays: { date: string; name: string }[];
  unsyncedYears: number[];
}

// 현재 KST 연/월 — UTC 기준이면 KST 월초 0~9시에 전월로 잡혀 엉뚱한 달을 패칭한다(R3 medium).
function kstNow() {
  const key = toKstDateKey(new Date()); // 'YYYY-MM-DD' (KST)
  return { y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)) - 1 }; // m: 0-based
}

export function LeaveCalendar({ canCreate, canManage }: { canCreate: boolean; canManage: boolean }) {
  const [cursor, setCursor] = useState(kstNow); // KST 기준 현재 월
  const [selectedJob, setSelectedJob] = useState<"ALL" | JobFunction>("ALL"); // 직무 필터(fetch 쿼리의 일부, 클라 필터 아님)
  const [creating, setCreating] = useState<string | null>(null); // 관리자 직접입력 모달 defaultDate(null=닫힘)
  const [requesting, setRequesting] = useState<string | null>(null); // 자가신청 모달 defaultDate(null=닫힘)

  const anchor = new Date(Date.UTC(cursor.y, cursor.m, 15, 3, 0, 0));
  // 표시되는 42칸 그리드(인접월 포함) 전체를 패칭 — 보이는 셀에 데이터 누락(가짜 빈칸) 없도록. R1 medium.
  const { start: winStart, end: winEnd } = normalizeToGridWindow(anchor);
  const startKey = toKstDateKey(winStart);
  const endKey = toKstDateKey(new Date(winEnd.getTime() - 1)); // winEnd는 exclusive(+42일) → 마지막 점유 날

  const { data } = useQuery({
    queryKey: ["leave", "calendar", startKey, endKey, selectedJob],
    queryFn: async (): Promise<CalendarResponse> => {
      const jobParam = selectedJob === "ALL" ? "" : `&job=${selectedJob}`;
      const res = await fetch(`/api/leave/calendar?start=${startKey}&end=${endKey}${jobParam}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`calendar ${res.status}`);
      return (await res.json()) as CalendarResponse;
    },
  });
  // 서버가 직무로 이미 거른 휴가 + 공휴일(직무 무관·항상 — D5).
  const events = [...leaveToEvents(data?.events ?? []), ...holidaysToEvents(data?.holidays ?? [])];
  const unsyncedYears = data?.unsyncedYears ?? [];

  const move = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.y, c.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

  // 빠른추가 + = 본인 자가신청(self-service) 모달 오픈. /api/leave/requests가 create 권한 enforce.
  const quickAdd = canCreate ? (dateKey: string) => setRequesting(dateKey) : undefined;

  return (
    <div className="space-y-3">
      {/* 툴바: 좌=직무 필터 + 년월, 우=nav(이전/오늘/다음) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {JOB_FILTERS.map((j) => (
            <Button
              key={j.value}
              size="sm"
              variant={selectedJob === j.value ? "default" : "outline"}
              aria-pressed={selectedJob === j.value}
              onClick={() => setSelectedJob(j.value)}
            >
              {j.label}
            </Button>
          ))}
        </div>
        <span className="font-medium">
          {cursor.y}년 {cursor.m + 1}월
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => move(-1)}>이전</Button>
          <Button size="sm" variant="outline" onClick={() => setCursor(kstNow())}>오늘</Button>
          <Button size="sm" variant="outline" onClick={() => move(1)}>다음</Button>
        </div>
      </div>

      {/* 변형 A 정적 범례(D3/D4): kind 토글 제거, 색 안내만. 대기중=점선·반려/취소=취소선 */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {[
          { kind: "HOLIDAY", label: "공휴일" },
          { kind: "ANNUAL", label: "연차" },
          { kind: "HALF", label: "반차" },
          { kind: "QUARTER", label: "반반차" },
        ].map((c) => (
          <span key={c.kind} className={cn("inline-flex items-center rounded-full px-2 py-0.5", kindClass(c.kind, "soft"))}>
            {c.label}
          </span>
        ))}
        <span className="inline-flex items-center rounded-full border border-dashed border-yellow-500 bg-amber-100 px-2 py-0.5 text-amber-700 dark:border-yellow-400 dark:bg-amber-500/25 dark:text-amber-200">
          대기중
        </span>
        <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-muted-foreground line-through">
          반려/취소
        </span>
      </div>

      {/* 미동기화 안내(D9): unsyncedYears 비어있지 않을 때만. 차단 모달 아님(범례·그리드와 공존). */}
      {unsyncedYears.length > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          {unsyncedYears.join(", ")}년 공휴일 정보를 불러오지 못했습니다.
        </p>
      )}

      <CalendarMonth
        anchor={anchor}
        events={events}
        intensity="soft"
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
                      setRequesting(dateKey);
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

      {creating !== null && (
        <CreateLeaveModal defaultDate={creating || undefined} onClose={() => setCreating(null)} />
      )}
      {requesting !== null && (
        <RequestLeaveModal defaultDate={requesting || undefined} onClose={() => setRequesting(null)} />
      )}
    </div>
  );
}
```

변경 요지(기존 대비):
- import: `kindClass` 추가, `JobFunction`(`@/lib/auth/types`) 추가, `holidaysToEvents` 추가, **`TYPE_LABEL` import 제거**(legendLabel 삭제로 orphan — 내 변경이 만든 orphan만 정리).
- state `selectedJob` 추가.
- query key에 `selectedJob` 추가, fetch에 `job` 파라미터, 반환 타입 `CalendarResponse`, `events`에 공휴일 병합, `unsyncedYears` 파생.
- 툴바 재배치(좌 직무·우 nav), 기존 상단 상태 키 줄(대기중/반려) 제거 → 변형 A 정적 범례로 대체.
- 미동기화 안내 추가.
- `CalendarMonth`에서 `legend`·`legendLabel` 제거(D3, kind 토글 끔).

### Step 4 — 실행(PASS 확인)

```bash
npm test -- tests/app/leave/leave-calendar.test.tsx
```

기대: 기존 4개 + 신규 6개 전부 PASS.

### Step 5 — 전체 게이트 + 커밋

```bash
npm run typecheck && npm run lint && npm test
git add "src/app/(app)/leave/_components/leave-calendar.tsx" tests/app/leave/leave-calendar.test.tsx
git commit -m "feat(leave): 캘린더 직무 필터 버튼·변형 A 정적 범례·공휴일 표시·미동기화 안내·nav 우측"
```

## Acceptance Criteria

- `npm test -- tests/app/leave/leave-calendar.test.tsx` → 기존+신규 green.
- `npm run typecheck` / `npm run lint`(boundaries 포함) / `npm test`(전체) → 모두 통과.
- 직무 버튼 4개·기본 '전체' 선택·클릭 시 전환. 정적 범례 6종. `unsyncedYears` 있을 때만 인라인 안내. nav 우측.
- `CalendarMonth`의 kind 토글 범례 비활성(D3).

## Cautions

- **Don't `selectedJob`을 클라이언트 측 필터로 쓰지 마라(events를 직접 거르지 마라).** 이유: 서버 필터(D1) — `selectedJob`은 query key·fetch 파라미터이고, 서버가 이미 거른 결과를 그대로 표시한다.
- **Don't 공휴일을 직무 필터로 빼지 마라.** 이유: 공휴일은 서버가 직무 무관하게 항상 반환(D5) — 클라이언트도 무조건 병합.
- **Don't 이 컴포넌트에서 admin `JOB_LABEL`을 import 하지 마라.** 이유: admin 전용 private 영역(spec §3.5) — 버튼 라벨은 인라인 상수(`전체/개발/민원/콘텐츠`).
- **Don't `@/components/ui/*` 외의 모듈 경계를 넘지 마라.** 이 파일은 `(app)` 영역이라 `@/components/ui/button`·`@/modules/calendar/*` import는 허용. `@/modules/*`가 `@/components/ui/*`를 import하는 것만 금지(여기선 무관).
- **Don't `TYPE_LABEL` 외의 기존 import를 제거하지 마라.** 이유: surgical — legendLabel 삭제로 생긴 orphan만 정리.
