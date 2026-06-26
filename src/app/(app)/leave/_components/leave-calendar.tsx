"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobFunction } from "@/lib/auth/types";
import { normalizeToGridWindow, toKstDateKey, isAnchorWithinWindow } from "@/modules/calendar/time";
import { MAX_ANCHOR_MONTHS } from "@/modules/calendar/constants";
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

  // 운영 창(now±MAX_ANCHOR_MONTHS) 밖으로 이동 못 하게 nav 비활성 — 범위 밖 요청·빈화면 위장 차단.
  const now = new Date();
  const prevAnchor = new Date(Date.UTC(cursor.y, cursor.m - 1, 15, 3, 0, 0));
  const nextAnchor = new Date(Date.UTC(cursor.y, cursor.m + 1, 15, 3, 0, 0));
  const canGoPrev = isAnchorWithinWindow(prevAnchor, now, MAX_ANCHOR_MONTHS);
  const canGoNext = isAnchorWithinWindow(nextAnchor, now, MAX_ANCHOR_MONTHS);

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
          <Button size="sm" variant="outline" onClick={() => move(-1)} disabled={!canGoPrev}>이전</Button>
          <Button size="sm" variant="outline" onClick={() => setCursor(kstNow())}>오늘</Button>
          <Button size="sm" variant="outline" onClick={() => move(1)} disabled={!canGoNext}>다음</Button>
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
