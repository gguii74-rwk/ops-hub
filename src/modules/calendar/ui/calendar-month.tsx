"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { buildMonthGrid, type GridDay } from "@/modules/calendar/ui/grid";
import { eventsForDay, packWeekLanes } from "@/modules/calendar/ui/lanes";
import { eventChipClass, kindClass, statusOverlay } from "@/modules/calendar/ui/kind-styles";
import type { CalendarEventInput, Intensity } from "@/modules/calendar/ui/event-input";
import { cn } from "@/lib/utils";
// ⚠ ui 프리미티브(@/components/ui/*)를 import하지 않는다 — module→ui는 eslint boundaries 위반(D1, R5 high).
// 팝오버(다이얼로그)는 raw 엘리먼트 + 인라인 포커스 트랩으로 구현(modal.tsx 동작을 모듈 내부에 재현).

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
  const dialogRef = useRef<HTMLDivElement | null>(null);
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

  // 닫기 = 선택 해제(직전 포커스 복원은 아래 트랩 effect cleanup이 수행).
  const close = useCallback(() => setSelected(null), []);

  const openDay = useCallback((index: number, day: GridDay) => {
    setSelected({ index, day });
  }, []);

  // 팝오버 이벤트는 캡처하지 않고 매 렌더 visible에서 파생 — 열린 채 리패칭돼도 갱신(R2 medium).
  const selectedEvents = selected ? eventsForDay(selected.day, visible) : [];

  // 팝오버 a11y(인라인): 패널 포커스 + Tab/Shift+Tab 트랩 + Esc + scroll-lock + 직전 포커스 복원(R3/R5).
  // modal.tsx와 동일 동작을 모듈 내부에 재현(ui import 금지, D1/R5).
  useEffect(() => {
    if (!selected) return;
    const prevActive = document.activeElement as HTMLElement | null;
    const panel = dialogRef.current;
    panel?.focus();
    const FOCUSABLE =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevActive?.focus?.();
    };
  }, [selected, close]);

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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelId}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-sm space-y-2 overflow-y-auto rounded-xl border border-border bg-card p-4 text-sm text-card-foreground shadow-lg outline-none"
          >
            <div className="flex items-center justify-between">
              <h3 id={labelId} className="font-medium">{selected.day.dateKey}</h3>
              <button type="button" aria-label="닫기" onClick={close} className="text-muted-foreground hover:text-foreground">
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
        </div>
      )}
    </div>
  );
}
