"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { normalizeToGridWindow, toKstDateKey } from "@/modules/calendar/time";
import { CalendarMonth } from "@/modules/calendar/ui/calendar-month";
import { eventChipClass } from "@/modules/calendar/ui/kind-styles";
import { TYPE_LABEL } from "@/modules/leave/labels";
import { CreateLeaveModal } from "./create-leave-modal";
import { RequestLeaveModal } from "./request-leave-modal";
import { leaveToEvents, type Ev } from "./leave-adapter";

// 현재 KST 연/월 — UTC 기준이면 KST 월초 0~9시에 전월로 잡혀 엉뚱한 달을 패칭한다(R3 medium).
function kstNow() {
  const key = toKstDateKey(new Date()); // 'YYYY-MM-DD' (KST)
  return { y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)) - 1 }; // m: 0-based
}

export function LeaveCalendar({ canCreate, canManage }: { canCreate: boolean; canManage: boolean }) {
  const [cursor, setCursor] = useState(kstNow); // KST 기준 현재 월
  const [creating, setCreating] = useState<string | null>(null); // 관리자 직접입력 모달 defaultDate(null=닫힘)
  const [requesting, setRequesting] = useState<string | null>(null); // 자가신청 모달 defaultDate(null=닫힘)

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

  // 빠른추가 + = 본인 자가신청(self-service) 모달 오픈. /api/leave/requests가 create 권한 enforce.
  const quickAdd = canCreate ? (dateKey: string) => setRequesting(dateKey) : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => move(-1)}>이전</Button>
        <Button size="sm" variant="outline" onClick={() => setCursor(kstNow())}>
          오늘
        </Button>
        <Button size="sm" variant="outline" onClick={() => move(1)}>다음</Button>
        <span className="font-medium">
          {cursor.y}년 {cursor.m + 1}월
        </span>
      </div>

      {/* 상태 키(정적 — 종류는 아래 범례 토글, 상태는 오버레이로 표현; D5/D12) */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded border border-dashed border-yellow-500 bg-amber-100" /> 대기중
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="line-through">반려/취소</span> (취소선)
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
