# Task 03 — `CalendarMonth` 통일 월간 컴포넌트

소프트 카드·시간방향·기간 막대(lane)·팝오버·범례 필터·빠른추가·a11y를 한 컴포넌트에 구현한다. 데이터 패칭·월 네비게이션은 보유하지 않는다(소비처 책임).

## Files

- **Create** `src/modules/calendar/ui/calendar-month.tsx`.
- **Create (test)** `tests/modules/calendar/calendar-month.test.tsx`.

## Prep

- 읽기: spec D3·D6·D7·D8·D9·D12·D13, §5(인터페이스 개요), entrypoint §Shared Contracts(`CalendarMonth` 인터페이스·핵심 재사용/규칙·테스트 컨벤션).
- 재사용: `buildMonthGrid`/`GridDay`(`grid.ts`, 무변경), `packWeekLanes`/`eventsForDay`(task 01), `kindClass`/`statusOverlay`/`eventChipClass`(task 02), `cn`(`@/lib/utils`).
- a11y 패턴 참고(복붙 아님): `src/components/ui/modal.tsx`(Esc·포커스·바깥클릭).
- §Shared Contracts items 사용: `CalendarEventInput`/`Intensity`(task 01), `DayDetailContext`/`CalendarMonthProps`(이 task가 정의·export).

## Deps

- task 01, task 02.

## Step 1 — 실패 테스트 작성

`tests/modules/calendar/calendar-month.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarMonth } from "@/modules/calendar/ui/calendar-month";
import type { CalendarEventInput } from "@/modules/calendar/ui/event-input";

afterEach(cleanup);

const ANCHOR = new Date("2026-06-15T03:00:00+09:00");
const NOW = new Date("2026-06-15T03:00:00+09:00");
const kst = (dateKey: string) => `${dateKey}T00:00:00+09:00`;

function ev(p: Partial<CalendarEventInput>): CalendarEventInput {
  return { id: "e1", title: "이벤트", kind: "WORKFLOW_TASK", start: kst("2026-06-10"), ...p };
}

describe("CalendarMonth — 색강도/오버레이", () => {
  it("intensity bold/soft가 막대 클래스에 반영", () => {
    const { rerender } = render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({})]} intensity="bold" />);
    expect(screen.getByText("이벤트").className).toContain("orange-500");
    rerender(<CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({})]} intensity="soft" />);
    expect(screen.getByText("이벤트").className).toContain("orange-100");
  });

  it("status 오버레이: PENDING 점선 / CANCELLED 취소선", () => {
    const { rerender } = render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({ status: "PENDING" })]} />);
    expect(screen.getByText("이벤트").className).toContain("border-dashed");
    rerender(<CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({ status: "CANCELLED" })]} />);
    expect(screen.getByText("이벤트").className).toContain("line-through");
  });
});

describe("CalendarMonth — 시간 방향", () => {
  it("오늘 셀은 날짜 숫자가 브랜드 채움, 지난날 셀은 음영 톤", () => {
    render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[]} />);
    const today = screen.getByRole("button", { name: "2026-06-15" });
    expect(within(today).getByText("15").className).toContain("bg-primary");
    const past = screen.getByRole("button", { name: "2026-06-10" });
    expect(past.className).toContain("bg-muted-foreground/5");
  });
});

describe("CalendarMonth — 팝오버(D8)", () => {
  it("셀 클릭 → renderDayDetail 호출·role=dialog 표시, Esc·바깥클릭 닫힘", () => {
    render(
      <CalendarMonth
        anchor={ANCHOR}
        now={NOW}
        events={[ev({})]}
        renderDayDetail={(ctx) => <p>상세:{ctx.dateKey}</p>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "2026-06-10" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("상세:2026-06-10")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renderDayDetail 미주입 시 기본 목록 렌더", () => {
    render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({})]} />);
    fireEvent.click(screen.getByRole("button", { name: "2026-06-10" }));
    expect(within(screen.getByRole("dialog")).getByText("이벤트")).toBeTruthy();
  });

  it("열린 팝오버는 events 변경(리패칭) 시 갱신된다 (R2 — stale 캡처 방지)", () => {
    const detail = (events: CalendarEventInput[]) => (
      <ul>{events.map((e) => <li key={e.id}>{e.title}</li>)}</ul>
    );
    const { rerender } = render(
      <CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({ id: "a", title: "기존연차" })]} renderDayDetail={(c) => detail(c.events)} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "2026-06-10" }));
    expect(within(screen.getByRole("dialog")).getByText("기존연차")).toBeTruthy();
    // 백그라운드 리패칭으로 그 날 이벤트가 교체됨 — 팝오버는 열린 채 갱신되어야 함
    rerender(
      <CalendarMonth anchor={ANCHOR} now={NOW} events={[ev({ id: "b", title: "갱신연차" })]} renderDayDetail={(c) => detail(c.events)} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("기존연차")).toBeNull();
    expect(within(dialog).getByText("갱신연차")).toBeTruthy();
  });
});

describe("CalendarMonth — 빠른추가(D9)", () => {
  it("onQuickAdd 미주입 → + 없음", () => {
    render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[]} />);
    expect(screen.queryByRole("button", { name: /추가/ })).toBeNull();
  });
  it("주입 시 + 노출·클릭 콜백(팝오버 안 열림)", () => {
    const onQuickAdd = vi.fn();
    render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[]} onQuickAdd={onQuickAdd} renderDayDetail={() => <p>x</p>} />);
    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 추가" }));
    expect(onQuickAdd).toHaveBeenCalledWith("2026-06-10");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("CalendarMonth — 범례 필터(D12)", () => {
  it("kind 토글로 해당 막대 숨김", () => {
    const events = [
      ev({ id: "a", title: "업무이벤트", kind: "WORKFLOW_TASK" }),
      ev({ id: "b", title: "공휴일이벤트", kind: "HOLIDAY" }),
    ];
    render(<CalendarMonth anchor={ANCHOR} now={NOW} events={events} legend />);
    expect(screen.getByText("업무이벤트")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "WORKFLOW_TASK" }));
    expect(screen.queryByText("업무이벤트")).toBeNull();
    expect(screen.getByText("공휴일이벤트")).toBeTruthy();
  });
});

describe("CalendarMonth — 키보드(D13)", () => {
  it("Enter로 팝오버, 방향키로 셀 포커스 이동", () => {
    render(<CalendarMonth anchor={ANCHOR} now={NOW} events={[]} renderDayDetail={() => <p>키보드</p>} />);
    const cell = screen.getByRole("button", { name: "2026-06-10" });
    cell.focus();
    fireEvent.keyDown(cell, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "2026-06-11" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "2026-06-11" }), { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
```

**Run (expect FAIL — 컴포넌트 없음):**
```bash
npm test -- tests/modules/calendar/calendar-month.test.tsx
```

## Step 2 — `CalendarMonth` 구현

`src/modules/calendar/ui/calendar-month.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { buildMonthGrid, type GridDay } from "@/modules/calendar/ui/grid";
import { eventsForDay, packWeekLanes } from "@/modules/calendar/ui/lanes";
import { eventChipClass, kindClass, statusOverlay } from "@/modules/calendar/ui/kind-styles";
import type { CalendarEventInput, Intensity } from "@/modules/calendar/ui/event-input";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_LANES = 3; // 셀에 표시할 최대 막대 수, 초과는 "+N"

export interface DayDetailContext {
  dateKey: string;
  iso: string;
  isPast: boolean;
  isToday: boolean;
  events: CalendarEventInput[];
  close: () => void;
}

export interface CalendarMonthProps {
  anchor: Date;
  events: CalendarEventInput[];
  intensity?: Intensity;
  now?: Date;
  legend?: boolean;
  legendLabel?: (kind: string) => string;
  onQuickAdd?: (dateKey: string) => void;
  renderDayDetail?: (ctx: DayDetailContext) => React.ReactNode;
}

interface Selected {
  index: number;
  day: GridDay;
  // dayEvents를 캡처하지 않는다 — 리패칭 시 stale(R2 medium). 렌더 시점에 visible에서 파생.
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function CalendarMonth({
  anchor,
  events,
  intensity = "bold",
  now,
  legend = false,
  legendLabel = (k) => k,
  onQuickAdd,
  renderDayDetail,
}: CalendarMonthProps) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Selected | null>(null);
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const labelId = useId();

  const skeleton = useMemo(() => buildMonthGrid(anchor, [], now), [anchor, now]);
  const weeks = useMemo(() => chunk(skeleton, 7), [skeleton]);
  const visible = useMemo(() => events.filter((e) => !hidden.has(e.kind)), [events, hidden]);
  const kindsPresent = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const e of events) if (!seen.has(e.kind)) { seen.add(e.kind); order.push(e.kind); }
    return order;
  }, [events]);

  const close = useCallback(() => {
    setSelected((cur) => {
      if (cur) cellRefs.current[cur.index]?.focus();
      return null;
    });
  }, []);

  // 팝오버: 열릴 때 패널 포커스, Esc·바깥(mousedown) 닫기.
  useEffect(() => {
    if (!selected) return;
    popoverRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [selected, close]);

  const openDay = useCallback((index: number, day: GridDay) => {
    setSelected({ index, day });
  }, []);

  // 팝오버 이벤트는 캡처하지 않고 매 렌더 visible에서 파생 — 열린 채 리패칭돼도 갱신(R2 medium).
  const selectedEvents = selected ? eventsForDay(selected.day, visible) : [];

  function focusCell(i: number) {
    if (i < 0 || i >= cellRefs.current.length) return;
    cellRefs.current[i]?.focus();
  }

  function onCellKey(e: React.KeyboardEvent, index: number, day: GridDay) {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        openDay(index, day);
        break;
      case "ArrowLeft":
        e.preventDefault();
        focusCell(index - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        focusCell(index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusCell(index - 7);
        break;
      case "ArrowDown":
        e.preventDefault();
        focusCell(index + 7);
        break;
    }
  }

  function toggleKind(kind: string) {
    setHidden((s) => {
      const next = new Set(s);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {legend && kindsPresent.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {kindsPresent.map((kind) => {
            const off = hidden.has(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={!off}
                onClick={() => toggleKind(kind)}
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] transition-opacity",
                  kindClass(kind, "soft"),
                  off && "opacity-40 line-through",
                )}
              >
                {legendLabel(kind)}
              </button>
            );
          })}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className={cn(
                "p-2 text-center text-xs font-medium text-muted-foreground",
                i === 0 && "text-rose-500/80",
                i === 6 && "text-blue-500/80",
              )}
            >
              {w}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => {
          const { lanes, more } = packWeekLanes(week, visible, MAX_LANES);
          return (
            <div key={wi} className="relative border-b border-border last:border-b-0">
              {/* 배경 셀(클릭 타깃) */}
              <div className="grid grid-cols-7">
                {week.map((day, di) => {
                  const index = wi * 7 + di;
                  const dayNum = Number(day.dateKey.slice(-2));
                  const tone = day.isPast
                    ? "bg-muted-foreground/5"
                    : !day.inMonth
                      ? "bg-muted/40"
                      : "bg-background";
                  return (
                    <div
                      key={day.dateKey}
                      ref={(el) => {
                        cellRefs.current[index] = el;
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={day.dateKey}
                      onClick={() => openDay(index, day)}
                      onKeyDown={(e) => onCellKey(e, index, day)}
                      className={cn(
                        "group/cell relative min-h-24 cursor-pointer border-r border-border p-1 text-left outline-none last:border-r-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                        tone,
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-none",
                          day.isToday
                            ? "bg-primary font-semibold text-primary-foreground"
                            : day.isPast || !day.inMonth
                              ? "text-muted-foreground"
                              : "font-medium text-foreground",
                        )}
                      >
                        {dayNum}
                      </span>
                      {onQuickAdd && (
                        <button
                          type="button"
                          aria-label={`${day.dateKey} 추가`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onQuickAdd(day.dateKey);
                          }}
                          className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-md text-muted-foreground ring-1 ring-border hover:bg-accent group-hover/cell:flex"
                        >
                          +
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 기간 막대 오버레이(pointer-events-none → 클릭은 배경 셀로 통과) */}
              <div className="pointer-events-none absolute inset-x-0 bottom-1 top-7 grid grid-cols-7 content-start gap-y-0.5">
                {lanes.flatMap((lane, li) =>
                  lane.segments.map((seg) => (
                    <div
                      key={seg.event.id}
                      style={{ gridColumn: `${seg.colStart} / ${seg.colEnd + 1}`, gridRow: li + 1 }}
                      title={seg.event.title}
                      className={cn(
                        "mx-px truncate rounded px-1 py-0.5 text-[11px] leading-tight",
                        kindClass(seg.event.kind, intensity),
                        statusOverlay(seg.event.status),
                        seg.continuesLeft && "rounded-l-none",
                        seg.continuesRight && "rounded-r-none",
                      )}
                    >
                      {seg.continuesLeft ? "◂ " : ""}
                      {seg.event.title}
                      {seg.continuesRight ? " ▸" : ""}
                    </div>
                  )),
                )}
                {more.map((n, col) =>
                  n > 0 ? (
                    <div
                      key={`more-${col}`}
                      style={{ gridColumn: `${col + 1} / ${col + 2}`, gridRow: MAX_LANES + 1 }}
                      className="mx-px truncate px-1 text-[10px] text-muted-foreground"
                    >
                      +{n}
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-labelledby={labelId}
          tabIndex={-1}
          className="fixed left-1/2 top-1/2 z-50 w-72 max-w-[90vw] -translate-x-1/2 -translate-y-1/2 space-y-2 rounded-xl border border-border bg-card p-3 text-sm shadow-lg outline-none"
        >
          <div className="flex items-center justify-between">
            <h3 id={labelId} className="font-medium">
              {selected.day.dateKey}
            </h3>
            <button
              type="button"
              aria-label="닫기"
              onClick={close}
              className="text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
          {renderDayDetail ? (
            renderDayDetail({
              dateKey: selected.day.dateKey,
              iso: selected.day.iso,
              isPast: selected.day.isPast,
              isToday: selected.day.isToday,
              events: selectedEvents,
              close,
            })
          ) : (
            <ul className="space-y-1">
              {selectedEvents.length === 0 && <li className="text-muted-foreground">일정 없음</li>}
              {selectedEvents.map((e) => (
                <li
                  key={e.id}
                  className={cn("truncate rounded px-1.5 py-0.5", eventChipClass(e.kind, "soft", e.status))}
                  title={e.title}
                >
                  {e.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

**Run (expect PASS):**
```bash
npm test -- tests/modules/calendar/calendar-month.test.tsx
```

## Step 3 — commit

```bash
git add src/modules/calendar/ui/calendar-month.tsx tests/modules/calendar/calendar-month.test.tsx
git commit -m "feat(calendar): 통일 월간 컴포넌트 CalendarMonth(소프트카드·lane막대·팝오버·범례·a11y)"
```

## Acceptance Criteria

```bash
npm test -- tests/modules/calendar/calendar-month.test.tsx   # 전부 PASS
npm run typecheck                                            # 에러 0
npm run lint                                                 # boundaries 통과(module→module 내부 import만)
```

## Cautions

- **데이터 패칭·월 네비게이션·"오늘" 버튼을 컴포넌트에 넣지 말 것.** 이유: spec §5 — 관심사 분리. 소비처가 react-query·anchor state를 보유. `CalendarMonth`는 한 달 렌더만.
- **막대 오버레이는 `pointer-events-none` 유지.** 이유: 막대 위 클릭도 셀 팝오버를 열어야 함(막대가 클릭을 가로채면 팝오버 안 열림). 빠른추가 `+`만 `pointer-events-auto`(별도 button, `group-hover/cell:flex`로 노출).
- **셀은 `div role="button"`(중첩 button 금지).** 이유: 빠른추가 `+`가 셀 안의 실제 `<button>`이라, 셀을 `<button>`으로 하면 button 중첩(무효 HTML). `+`는 `stopPropagation`으로 셀 클릭과 분리.
- **`buildMonthGrid(anchor, [], now)`로 호출**(events=빈 배열). 이유: 스켈레톤(날짜 메타데이터)만 필요. 이벤트 배치는 `packWeekLanes`가 `CalendarEventInput`으로 수행. `grid.ts` 무변경(D10).
- **범례 필터를 서버 재요청과 연결하지 말 것.** 이유: D12 — 클라이언트 로컬 state, 표시 전용. 이미 받은 events를 `visible`로 필터.
- **팝오버 이벤트를 `selected` state에 캡처하지 말 것(R2 medium).** 이유: 소비처 events는 react-query 파생 → 백그라운드 리패칭 시 캡처본은 stale(취소/승인/추가 미반영). `selected`는 `{index, day}`만 두고 `selectedEvents = eventsForDay(selected.day, visible)`로 **매 렌더 파생**한다. 위 리렌더 테스트가 회귀를 막는다.
