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

  // 5종 create 권한을 각각 무조건 호출(hook 순서 고정 — react-hooks 규칙). OR는 boolean 값끼리 결합.
  // 주의: `useCan(...) || useCan(...)`처럼 hook을 || 체인 우변에 두면 short-circuit으로 렌더마다
  // hook(useContext) 호출 수가 달라져 Rules of Hooks 위반 + react-hooks/rules-of-hooks lint 실패.
  const canCreateBilling = useCan("workflows.billing", "create");
  const canCreateNotification = useCan("workflows.notification", "create");
  const canCreateWeekly = useCan("workflows.weekly", "create");
  const canCreateWeeklyClient = useCan("workflows.weeklyClient", "create");
  const canCreateMonthlyClient = useCan("workflows.monthlyClient", "create");
  const canCreateAny =
    canCreateBilling || canCreateNotification || canCreateWeekly || canCreateWeeklyClient || canCreateMonthlyClient;

  const anchor = new Date(Date.UTC(cursor.y, cursor.m, 15, 3, 0, 0));
  // 표시 42칸 그리드 전체를 패칭. end=winEnd(exclusive, 마지막 셀 다음날) — scheduledAt<end가 마지막 셀 포함(R4·F2).
  const { start: winStart, end: winEnd } = normalizeToGridWindow(anchor);
  const startIso = winStart.toISOString();
  const endIso = winEnd.toISOString();

  const { data, isError } = useQuery({
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

      {/* 조회 실패 에러상태(SC-13) — 빈 캘린더 위장 금지. 정본=calendar-view line 125. */}
      {isError && (
        <p className="text-sm text-destructive">업무 캘린더를 불러오지 못했습니다.</p>
      )}

      {creating !== null && (
        <CreateTaskModal defaultDate={creating || undefined} onClose={() => setCreating(null)} />
      )}
    </div>
  );
}
