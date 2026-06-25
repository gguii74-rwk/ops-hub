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
