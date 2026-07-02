"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkflowsCalendar } from "./workflows-calendar";
import { WorkflowsList } from "./workflows-list";

// /workflows 진입점: 캘린더(운영창 ±MAX_ANCHOR_MONTHS 브라우징)와 목록(전체 이력)을 토글로 함께 제공.
// 캘린더가 기본 뷰(D11 nav "캘린더"), 목록은 운영창 밖 과거/미래 작업 접근 경로(감사·재다운로드).
export function WorkflowsView() {
  const [view, setView] = useState<"calendar" | "list">("calendar");
  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <Button
          size="sm"
          variant={view === "calendar" ? "default" : "outline"}
          aria-pressed={view === "calendar"}
          onClick={() => setView("calendar")}
        >
          캘린더
        </Button>
        <Button
          size="sm"
          variant={view === "list" ? "default" : "outline"}
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
        >
          목록
        </Button>
      </div>
      {view === "calendar" ? <WorkflowsCalendar /> : <WorkflowsList />}
    </div>
  );
}
