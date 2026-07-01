# Task 05 — 캘린더 화면 (workflows-calendar.tsx) + page 교체 + list 제거

`/workflows`를 월 캘린더로 완성한다: `CalendarMonth` 재사용 + 단일선택 필터(전체+5) + 그리드 윈도우 조회(exclusive end) + 날짜 팝오버(목록→상세 이동 + 새 작업 등록) + 셀 "+" 빠른추가. `page.tsx`가 `WorkflowsCalendar`를 렌더하고 `workflows-list.tsx`(+테스트)를 제거한다.

## Files
- Create: `src/app/(app)/workflows/workflows-calendar.tsx`
- Modify: `src/app/(app)/workflows/page.tsx` (`WorkflowsList`→`WorkflowsCalendar`, `KINDS` enum-파생)
- Delete: `src/app/(app)/workflows/workflows-list.tsx` (orphan — 캘린더로 교체)
- Delete: `tests/app/workflows/workflows-list.test.tsx` (제거된 컴포넌트 테스트)
- Test: `tests/app/workflows/workflows-calendar.test.tsx` (신규)

## Prep
- 엔트리포인트 §Shared Contracts SC-5(라벨·순서), SC-6(색), SC-8(어댑터), SC-9(조회 계약·exclusive end).
- 참조 구현: `src/app/(app)/leave/_components/leave-calendar.tsx`(전체 구조·nav 경계·kstNow·팝오버), `tests/app/leave/leave-calendar.test.tsx`(테스트 관례·`open15th`).
- `src/modules/calendar/ui/calendar-month.tsx`(`CalendarMonth` props: `anchor`·`events`·`intensity`·`onQuickAdd`·`renderDayDetail`).
- D4·D6·D8·D9, R1(fetch start/end), R4·F2(exclusive end).

## Deps
- Task 02(`toCalendarEvent`·`KIND_LABEL`·`WORKFLOW_KIND_ORDER`·kind 색), Task 03(`GET /api/workflows/calendar`), Task 04(`CreateTaskModal` `defaultDate` prop).

## Cautions
- **Don't `selectedKind`를 queryKey/서버에 넣지 마라.** kind 필터는 **클라 필터**(응답 `kind` 사용). 서버 재조회 없음(D5).
- **Don't `winEnd-1`을 보내지 마라.** `end = winEnd`(exclusive) 그대로 — `scheduledAt<end`가 마지막 그리드 셀 포함(R4·F2). 연차의 inclusive-key(`winEnd-1`) 방식과 **다름**.
- **Don't `useCan`을 조건/루프에서 호출하지 마라.** `canCreateAny`는 5종 고정 호출의 OR.
- **Don't `CalendarMonth`의 토글 `legend` prop을 쓰지 마라.** 필터는 별도 버튼(D6). 정적 색 범례만 별도 렌더.
- **Don't `workflows-list.tsx` 제거를 빠뜨리지 마라.** spec 비포함: 목록 뷰 완전 교체(내 변경이 만든 orphan). import 소비처(page.tsx)도 함께 전환.
- **Don't ui 프리미티브를 `CalendarMonth`(module)에 넘기지 마라** — 팝오버는 CalendarMonth 내장(module→ui 금지). 페이지·모달에서만 `@/components/ui/*` 사용.

## TDD Steps

### 1. 캘린더 컴포넌트 — 실패 테스트 먼저

`tests/app/workflows/workflows-calendar.test.tsx` 생성:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeToGridWindow, toKstDateKey } from "@/modules/calendar/time";

const push = vi.hoisted(() => vi.fn());
const can = vi.hoisted(() => ({ create: false }));
const q = vi.hoisted(() => ({ items: [] as any[], lastQueryFn: null as null | (() => Promise<unknown>) }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/auth/permissions-client", () => ({
  useCan: (_r: string, a: string) => a === "create" && can.create,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryFn: () => Promise<unknown> }) => { q.lastQueryFn = opts.queryFn; return { data: { items: q.items } }; },
}));
// 모달은 스텁(자체 useCan/useMutation 격리).
vi.mock("@/app/(app)/workflows/create-task-modal", () => ({
  CreateTaskModal: ({ defaultDate }: { defaultDate?: string }) => <div data-testid="create-modal">{defaultDate ?? "no-date"}</div>,
}));

import { WorkflowsCalendar } from "@/app/(app)/workflows/workflows-calendar";

// 현재 KST 달의 15일(항상 inMonth) 정오 ISO — 셀에 이벤트를 얹기 위한 안정 날짜.
function month15Iso() {
  const key = toKstDateKey(new Date());
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1;
  return new Date(Date.UTC(y, m, 15, 3, 0, 0)).toISOString();
}
function open15th() {
  const cells = screen.getAllByRole("button").filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.getAttribute("aria-label") ?? ""));
  const target = cells.find((b) => (b.getAttribute("aria-label") ?? "").endsWith("-15"))!;
  fireEvent.click(target);
}

beforeEach(() => { q.items = []; q.lastQueryFn = null; can.create = false; push.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("WorkflowsCalendar — 필터(D6)", () => {
  it("필터 버튼 6개(전체+5 kind)·기본 전체", () => {
    render(<WorkflowsCalendar />);
    for (const label of ["전체", "대금청구", "알림톡청구", "주간보고(본부)", "주간보고(고객사)", "월간보고(고객사)"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "전체" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("필터 클릭 시 단일선택 전환", () => {
    render(<WorkflowsCalendar />);
    fireEvent.click(screen.getByRole("button", { name: "대금청구" }));
    expect(screen.getByRole("button", { name: "대금청구" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "전체" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("kind 미스매치는 숨김(클라 필터)", () => {
    q.items = [
      { id: "b1", kind: "BILLING", typeName: "대금청구", scheduledAt: month15Iso(), status: "PENDING" },
      { id: "w1", kind: "WEEKLY_REPORT", typeName: "주간보고(본부)", scheduledAt: month15Iso(), status: "PENDING" },
    ];
    render(<WorkflowsCalendar />);
    fireEvent.click(screen.getByRole("button", { name: "대금청구" }));
    open15th();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("대금청구")).toBeTruthy();
    expect(within(dialog).queryByText("주간보고(본부)")).toBeNull();
  });
});

describe("WorkflowsCalendar — 팝오버·생성(D9)", () => {
  it("빈 날짜는 '업무 없음'", () => {
    render(<WorkflowsCalendar />);
    open15th();
    expect(within(screen.getByRole("dialog")).getByText("업무 없음")).toBeTruthy();
  });

  it("생성 권한 없으면 '+' 빠른추가·'새 작업 등록' 미노출", () => {
    can.create = false;
    render(<WorkflowsCalendar />);
    expect(screen.queryByRole("button", { name: /추가/ })).toBeNull();
    open15th();
    expect(within(screen.getByRole("dialog")).queryByText("새 작업 등록")).toBeNull();
  });

  it("생성 권한 있으면 '+' 빠른추가·'새 작업 등록' 노출", () => {
    can.create = true;
    render(<WorkflowsCalendar />);
    expect(screen.getAllByRole("button", { name: /추가/ }).length).toBeGreaterThan(0);
    open15th();
    expect(within(screen.getByRole("dialog")).getByText("새 작업 등록")).toBeTruthy();
  });

  it("'새 작업 등록' 클릭 시 생성 모달(defaultDate=그날)", () => {
    can.create = true;
    render(<WorkflowsCalendar />);
    open15th();
    fireEvent.click(within(screen.getByRole("dialog")).getByText("새 작업 등록"));
    const modal = screen.getByTestId("create-modal");
    expect(modal.textContent).toMatch(/^\d{4}-\d{2}-15$/);
  });

  it("작업 클릭 시 상세로 이동", () => {
    q.items = [{ id: "b1", kind: "BILLING", typeName: "대금청구", scheduledAt: month15Iso(), status: "PENDING" }];
    render(<WorkflowsCalendar />);
    open15th();
    fireEvent.click(within(screen.getByRole("dialog")).getByText("대금청구"));
    expect(push).toHaveBeenCalledWith("/workflows/b1");
  });
});

describe("WorkflowsCalendar — 조회 URL(R1·R4)·nav 경계(D10)", () => {
  it("queryFn URL에 start·end(exclusive winEnd) 포함", async () => {
    render(<WorkflowsCalendar />);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    await q.lastQueryFn!();
    const url = fetchMock.mock.calls[0][0] as string;
    const key = toKstDateKey(new Date());
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(5, 7)) - 1;
    const { start, end } = normalizeToGridWindow(new Date(Date.UTC(y, m, 15, 3, 0, 0)));
    expect(url).toContain(`start=${encodeURIComponent(start.toISOString())}`);
    expect(url).toContain(`end=${encodeURIComponent(end.toISOString())}`); // exclusive end(R4·F2)
  });

  it("이전/오늘/다음 버튼 존재·초기 활성", () => {
    render(<WorkflowsCalendar />);
    for (const label of ["이전", "오늘", "다음"]) expect(screen.getByRole("button", { name: label })).toBeTruthy();
    expect((screen.getByRole("button", { name: "다음" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("다음 12번 → +12개월 경계에서 다음 비활성", () => {
    render(<WorkflowsCalendar />);
    for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect((screen.getByRole("button", { name: "다음" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("WorkflowsCalendar — 범례(D8)", () => {
  it("5 kind 색칩 + 취소됨 안내", () => {
    render(<WorkflowsCalendar />);
    // 범례는 색칩(라벨 텍스트)로 렌더 — 필터 버튼과 텍스트 중복이라 getAllByText로 존재만 확인
    for (const label of ["대금청구", "알림톡청구", "주간보고(본부)", "주간보고(고객사)", "월간보고(고객사)"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("취소됨")).toBeTruthy();
  });
});
```

실행: `npm test -- tests/app/workflows/workflows-calendar.test.tsx` → **FAIL**(컴포넌트 없음).

### 2. 캘린더 컴포넌트 구현

`src/app/(app)/workflows/workflows-calendar.tsx` 생성:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { WorkflowKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCan } from "@/lib/auth/permissions-client";
import { normalizeToGridWindow, toKstDateKey, isAnchorWithinWindow } from "@/modules/calendar/time";
import { MAX_ANCHOR_MONTHS } from "@/modules/calendar/constants";
import { CalendarMonth } from "@/modules/calendar/ui/calendar-month";
import { eventChipClass, kindClass } from "@/modules/calendar/ui/kind-styles";
import { CreateTaskModal } from "./create-task-modal";
import { toCalendarEvent, type WorkflowCalendarItem } from "./workflow-calendar-adapter";
import { KIND_LABEL, WORKFLOW_KIND_ORDER } from "./labels";

// 단일선택 필터(전체 + 5 kind, D6). 값 = "ALL" | WorkflowKind.
const FILTERS: { value: "ALL" | WorkflowKind; label: string }[] = [
  { value: "ALL", label: "전체" },
  ...WORKFLOW_KIND_ORDER.map((k) => ({ value: k, label: KIND_LABEL[k] })),
];

interface CalendarResponse { items: WorkflowCalendarItem[]; }

// 현재 KST 연/월 — UTC 기준이면 KST 월초 0~9시에 전월로 잡혀 엉뚱한 달을 패칭(leave와 동일 방어).
function kstNow() {
  const key = toKstDateKey(new Date());
  return { y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)) - 1 };
}

export function WorkflowsCalendar() {
  const router = useRouter();
  const [cursor, setCursor] = useState(kstNow); // KST 기준 현재 월
  const [selectedKind, setSelectedKind] = useState<"ALL" | WorkflowKind>("ALL"); // 클라 필터(재조회 없음)
  const [creating, setCreating] = useState<string | null>(null); // 생성 모달 defaultDate(null=닫힘)

  // 5종 중 하나라도 create면 빠른추가/새작업 노출. useCan 고정 호출(react-hooks 규칙).
  const canCreateAny =
    useCan("workflows.billing", "create") ||
    useCan("workflows.notification", "create") ||
    useCan("workflows.weekly", "create") ||
    useCan("workflows.weeklyClient", "create") ||
    useCan("workflows.monthlyClient", "create");

  const anchor = new Date(Date.UTC(cursor.y, cursor.m, 15, 3, 0, 0));
  // 표시 42칸 그리드 전체를 패칭. end=winEnd(exclusive, 마지막 셀 다음날) — scheduledAt<end가 마지막 셀 포함(R4·F2).
  const { start: winStart, end: winEnd } = normalizeToGridWindow(anchor);
  const startIso = winStart.toISOString();
  const endIso = winEnd.toISOString();

  const { data } = useQuery({
    queryKey: ["workflows", "calendar", startIso, endIso],
    queryFn: async (): Promise<CalendarResponse> => {
      const res = await fetch(
        `/api/workflows/calendar?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`calendar ${res.status}`);
      return (await res.json()) as CalendarResponse;
    },
  });

  const items = data?.items ?? [];
  const visible = items.filter((i) => selectedKind === "ALL" || i.kind === selectedKind);
  const events = visible.map(toCalendarEvent);

  const move = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.y, c.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

  // 운영 창(now±MAX_ANCHOR_MONTHS) 밖 이동 차단(leave와 동일).
  const now = new Date();
  const prevAnchor = new Date(Date.UTC(cursor.y, cursor.m - 1, 15, 3, 0, 0));
  const nextAnchor = new Date(Date.UTC(cursor.y, cursor.m + 1, 15, 3, 0, 0));
  const canGoPrev = isAnchorWithinWindow(prevAnchor, now, MAX_ANCHOR_MONTHS);
  const canGoNext = isAnchorWithinWindow(nextAnchor, now, MAX_ANCHOR_MONTHS);

  const quickAdd = canCreateAny ? (dateKey: string) => setCreating(dateKey) : undefined;

  return (
    <div className="space-y-3">
      {/* 툴바: 좌=필터(전체+5) + 년월, 우=nav */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={selectedKind === f.value ? "default" : "outline"}
              aria-pressed={selectedKind === f.value}
              onClick={() => setSelectedKind(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <span className="font-medium">{cursor.y}년 {cursor.m + 1}월</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => move(-1)} disabled={!canGoPrev}>이전</Button>
          <Button size="sm" variant="outline" onClick={() => setCursor(kstNow())}>오늘</Button>
          <Button size="sm" variant="outline" onClick={() => move(1)} disabled={!canGoNext}>다음</Button>
        </div>
      </div>

      {/* 정적 색 범례(D8): kind 색칩 + 취소 안내(취소만 취소선, PENDING 등은 kind색 유지). */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {WORKFLOW_KIND_ORDER.map((k) => (
          <span key={k} className={cn("inline-flex items-center rounded-full px-2 py-0.5", kindClass(k, "soft"))}>
            {KIND_LABEL[k]}
          </span>
        ))}
        <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-muted-foreground line-through">
          취소됨
        </span>
      </div>

      <CalendarMonth
        anchor={anchor}
        events={events}
        intensity="bold"
        onQuickAdd={quickAdd}
        renderDayDetail={({ dateKey, events: dayEvents, close }) => (
          <div className="space-y-2">
            <ul className="space-y-1">
              {dayEvents.length === 0 && <li className="text-muted-foreground">업무 없음</li>}
              {dayEvents.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => { close(); router.push(`/workflows/${e.id}`); }}
                    title={e.title}
                    className={cn(
                      "block w-full truncate rounded px-1.5 py-0.5 text-left text-xs",
                      eventChipClass(e.kind, "bold", e.status),
                    )}
                  >
                    {e.title}
                  </button>
                </li>
              ))}
            </ul>
            {canCreateAny && (
              <Button size="sm" className="w-full" onClick={() => { close(); setCreating(dateKey); }}>
                새 작업 등록
              </Button>
            )}
          </div>
        )}
      />

      {creating !== null && (
        <CreateTaskModal defaultDate={creating || undefined} onClose={() => setCreating(null)} />
      )}
    </div>
  );
}
```

실행: `npm test -- tests/app/workflows/workflows-calendar.test.tsx` → **PASS**.

### 3. page.tsx 교체 + list 제거

`src/app/(app)/workflows/page.tsx` 전면 교체(`WorkflowsList`→`WorkflowsCalendar`, `KINDS` enum-파생 — F1 page 부분):

```tsx
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { KIND_RESOURCE } from "@/modules/workflows/policy";
import type { WorkflowKind } from "@prisma/client";
import { PageSection } from "@/components/ui/page-section";
import { EmptyState } from "@/components/ui/states";
import { WorkflowsCalendar } from "./workflows-calendar";

// F1: enum-파생(하드코딩 배열 금지 — 신규 kind 자동 포함).
const KINDS = Object.keys(KIND_RESOURCE) as WorkflowKind[];

export default async function WorkflowsPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const keySet = new Set(keys);
  // page shell은 per-kind view로 EmptyState 판정 유지(D13: 집계 grant와 동기 보장).
  const allowed = KINDS.filter((k) => keySet.has(`${KIND_RESOURCE[k]}:view`));

  return (
    <PageSection title="업무 캘린더">
      {allowed.length === 0 ? (
        <EmptyState>열람 권한이 있는 업무가 없습니다.</EmptyState>
      ) : (
        <WorkflowsCalendar />
      )}
    </PageSection>
  );
}
```

파일 삭제:
```bash
git rm src/app/(app)/workflows/workflows-list.tsx tests/app/workflows/workflows-list.test.tsx
```

소비처 확인(다른 import 없음 보장):
```bash
grep -rn "workflows-list\|WorkflowsList" src tests
```
기대: 결과 없음(모두 제거됨).

### 4. 커밋

```bash
npm run typecheck && npm run lint && npm test
```
기대: 전부 green(전체 스위트). 이후 커밋.

## Acceptance Criteria
- `npm run typecheck` → 통과.
- `npm run lint` → 통과(boundaries — 캘린더가 `CalendarMonth`만 소비, 페이지/모달만 ui).
- `npm test -- tests/app/workflows/workflows-calendar.test.tsx` → 통과.
- `npm test`(전체) → 통과(제거된 `workflows-list.test.tsx` 부재로 회귀 없음).
- `grep -rn "workflows-list\|WorkflowsList" src tests` → 결과 없음.
- 캘린더: 필터 6(전체+5)·단일선택·클라 필터, 팝오버 목록→상세 이동·생성 버튼(권한별), 셀 "+"(권한별), nav 운영창 경계, fetch URL에 start+exclusive end.
