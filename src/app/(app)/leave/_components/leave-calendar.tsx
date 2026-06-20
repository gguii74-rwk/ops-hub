"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getFullLeaveText } from "@/modules/leave/labels";
import { CreateLeaveModal } from "./create-leave-modal";

interface Ev {
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

const ymd = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function colorFor(e: Ev): string {
  if (e.status === "PENDING") return "bg-amber-100 text-amber-900";
  if (e.status === "REJECTED" || e.status === "CANCELLED") return "bg-muted text-muted-foreground";
  if (e.leaveType === "HALF") return "bg-emerald-100 text-emerald-900";
  if (e.leaveType === "QUARTER") return "bg-violet-100 text-violet-900";
  return "bg-sky-100 text-sky-900"; // ANNUAL APPROVED
}

export function LeaveCalendar({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getUTCFullYear(), m: today.getUTCMonth() }); // m: 0-based
  const [creating, setCreating] = useState<string | null>(null);

  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const last = new Date(Date.UTC(cursor.y, cursor.m + 1, 0));
  const { data } = useQuery({
    queryKey: ["leave", "calendar", cursor.y, cursor.m],
    queryFn: async (): Promise<Ev[]> => {
      const res = await fetch(
        `/api/leave/calendar?start=${ymd(first)}&end=${ymd(last)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`calendar ${res.status}`);
      return (await res.json()).events as Ev[];
    },
  });
  const events = data ?? [];

  // 날짜별 이벤트(기간 걸침 포함)
  const eventsOn = (day: number) => {
    const key = ymd(new Date(Date.UTC(cursor.y, cursor.m, day)));
    return events.filter((e) => e.startDate.slice(0, 10) <= key && key <= e.endDate.slice(0, 10));
  };

  const daysInMonth = last.getUTCDate();
  const leadBlanks = first.getUTCDay(); // 0=일
  const cells: (number | null)[] = [
    ...Array(leadBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const move = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.y, c.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => move(-1)}>
          이전
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCursor({ y: today.getUTCFullYear(), m: today.getUTCMonth() })}
        >
          오늘
        </Button>
        <Button size="sm" variant="outline" onClick={() => move(1)}>
          다음
        </Button>
        <span className="font-medium">
          {cursor.y}년 {cursor.m + 1}월
        </span>
        {canManage && (
          <Button size="sm" className="ml-auto" onClick={() => setCreating("")}>
            + 연차 입력
          </Button>
        )}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-sm">
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <div key={d} className="bg-muted p-2 text-center text-xs text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map((day, i) => (
          <div key={i} className="min-h-20 bg-background p-1">
            {day && (
              <button
                type="button"
                className="mb-1 block w-full text-left text-xs text-muted-foreground hover:text-foreground"
                onClick={() =>
                  router.push(
                    `/leave/request?date=${ymd(new Date(Date.UTC(cursor.y, cursor.m, day)))}`,
                  )
                }
              >
                {day}
              </button>
            )}
            <div className="space-y-0.5">
              {day &&
                eventsOn(day).map((e) => (
                  <div
                    key={e.id}
                    className={cn("truncate rounded px-1 py-0.5 text-[11px]", colorFor(e))}
                    title={`${e.name} · ${getFullLeaveText(e.leaveType, e.leaveSubType, e.quarterStartTime)}`}
                  >
                    {e.name} {getFullLeaveText(e.leaveType, e.leaveSubType, e.quarterStartTime)}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
      <Card className="flex flex-wrap gap-3 p-3 text-xs text-muted-foreground">
        <span>
          <span className="mr-1 inline-block h-3 w-3 rounded bg-sky-100 align-middle" />
          연차
        </span>
        <span>
          <span className="mr-1 inline-block h-3 w-3 rounded bg-emerald-100 align-middle" />
          반차
        </span>
        <span>
          <span className="mr-1 inline-block h-3 w-3 rounded bg-violet-100 align-middle" />
          반반차
        </span>
        <span>
          <span className="mr-1 inline-block h-3 w-3 rounded bg-amber-100 align-middle" />
          대기중
        </span>
        <span>
          <span className="mr-1 inline-block h-3 w-3 rounded bg-muted align-middle" />
          반려/취소
        </span>
      </Card>
      {creating !== null && <CreateLeaveModal onClose={() => setCreating(null)} />}
    </div>
  );
}
