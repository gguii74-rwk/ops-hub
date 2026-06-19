"use client";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildMonthGrid } from "@/modules/calendar/ui/grid";
import type { FeedResponse, ViewKey } from "@/modules/calendar/types";
import { Button } from "@/components/ui/button";

const VIEW_LABEL: Record<ViewKey, string> = { work: "업무", leave: "휴가", personal: "개인", team: "팀", admin: "관리자" };
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// kind별 칩 색(브랜드 팔레트 semantic 토큰).
const KIND_CLASS: Record<string, string> = {
  INTERNAL_LEAVE: "bg-accent",
  EXTERNAL_VACATION: "bg-accent/70",
  WORKFLOW_TASK: "bg-secondary",
  HOLIDAY: "bg-destructive/15 text-destructive",
  EXTERNAL_EVENT: "bg-muted",
  PERSONAL_EVENT: "bg-primary/15",
  TEAM_EVENT: "bg-primary/10",
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
// 월 경계 시각·브라우저 TZ에 무관하게 서버의 KST 정규화가 항상 같은 달을 잡게 한다.
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
          <Button size="sm" variant="outline" onClick={refresh} disabled={query.isFetching || refreshing}>새로고침</Button>
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
        {grid.map((day) => {
          const dayNum = Number(day.dateKey.slice(-2));
          // 셀 배경: 지난날은 회색 음영(muted는 거의 흰색이라 muted-foreground 기반으로 확실히 구분),
          // 이번 달 외 미래는 옅게, 오늘·이번 달 미래는 기본.
          const cellTone = day.isPast ? "bg-muted-foreground/10" : !day.inMonth ? "bg-muted/40" : "";
          const dimNumber = day.isPast || !day.inMonth; // 지난날·달력 외 → 숫자 흐리게
          return (
            <div key={day.dateKey} className={`min-h-24 border-b border-r border-border p-1 ${cellTone}`}>
              <div className="text-xs">
                {day.isToday ? (
                  // 오늘: 브랜드 색 동그라미로 강조.
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold leading-none text-primary-foreground">
                    {dayNum}
                  </span>
                ) : (
                  <span className={dimNumber ? "text-muted-foreground" : "font-medium"}>{dayNum}</span>
                )}
              </div>
              <div className={`mt-1 space-y-0.5 ${day.isPast ? "opacity-60" : ""}`}>
                {day.events.map((e) => (
                  <div key={e.id} className={`truncate rounded px-1 py-0.5 text-[11px] ${KIND_CLASS[e.kind] ?? "bg-accent"}`} title={e.title}>
                    {e.title}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {query.isError && <p className="text-sm text-destructive">캘린더를 불러오지 못했습니다.</p>}
    </div>
  );
}
