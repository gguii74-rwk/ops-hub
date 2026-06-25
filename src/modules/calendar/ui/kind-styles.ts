import { cn } from "@/lib/utils";
import type { Intensity, EventStatus } from "./event-input";

interface KindStyle {
  soft: string;
  bold: string;
}

// kind → 색(soft/bold). D4: 네비 팔레트 계승 + 연차 전용 leaveType(ANNUAL/HALF/QUARTER).
// soft는 현 calendar-view KIND_CLASS 이전, bold는 같은 계열 진한 배경.
const KIND_STYLES: Record<string, KindStyle> = {
  INTERNAL_LEAVE: {
    soft: "bg-emerald-100 text-emerald-950 ring-1 ring-emerald-300/70 dark:bg-emerald-500/20 dark:text-emerald-100 dark:ring-emerald-400/30",
    bold: "bg-emerald-500 text-white ring-1 ring-emerald-600/40 dark:bg-emerald-500/80 dark:text-emerald-50 dark:ring-emerald-400/40",
  },
  EXTERNAL_VACATION: {
    soft: "bg-lime-100 text-lime-950 ring-1 ring-lime-300/70 dark:bg-lime-400/20 dark:text-lime-100 dark:ring-lime-300/30",
    bold: "bg-lime-500 text-lime-950 ring-1 ring-lime-600/40 dark:bg-lime-500/80 dark:text-lime-50 dark:ring-lime-400/40",
  },
  WORKFLOW_TASK: {
    soft: "bg-orange-100 text-orange-950 ring-1 ring-orange-300/70 dark:bg-orange-500/20 dark:text-orange-100 dark:ring-orange-300/30",
    bold: "bg-orange-500 text-white ring-1 ring-orange-600/40 dark:bg-orange-500/80 dark:text-orange-50 dark:ring-orange-400/40",
  },
  HOLIDAY: {
    soft: "bg-rose-100 text-rose-950 ring-1 ring-rose-300/70 dark:bg-rose-500/20 dark:text-rose-100 dark:ring-rose-300/30",
    bold: "bg-rose-500 text-white ring-1 ring-rose-600/40 dark:bg-rose-500/80 dark:text-rose-50 dark:ring-rose-400/40",
  },
  EXTERNAL_EVENT: {
    soft: "bg-slate-200 text-slate-800 ring-1 ring-slate-300 dark:bg-slate-700/50 dark:text-slate-100 dark:ring-slate-600",
    bold: "bg-slate-500 text-white ring-1 ring-slate-600/40 dark:bg-slate-600/80 dark:text-slate-50 dark:ring-slate-500/40",
  },
  PERSONAL_EVENT: {
    soft: "bg-indigo-100 text-indigo-950 ring-1 ring-indigo-300/70 dark:bg-indigo-500/20 dark:text-indigo-100 dark:ring-indigo-300/30",
    bold: "bg-indigo-500 text-white ring-1 ring-indigo-600/40 dark:bg-indigo-500/80 dark:text-indigo-50 dark:ring-indigo-400/40",
  },
  TEAM_EVENT: {
    soft: "bg-cyan-100 text-cyan-950 ring-1 ring-cyan-300/70 dark:bg-cyan-500/20 dark:text-cyan-100 dark:ring-cyan-300/30",
    bold: "bg-cyan-500 text-white ring-1 ring-cyan-600/40 dark:bg-cyan-500/80 dark:text-cyan-50 dark:ring-cyan-400/40",
  },
  // 연차 전용(leaveType을 kind로) — soft만 사용(intensity="soft"), bold는 형 통일용.
  ANNUAL: {
    soft: "bg-emerald-100 text-emerald-950 ring-1 ring-emerald-300/70 dark:bg-emerald-500/20 dark:text-emerald-100 dark:ring-emerald-400/30",
    bold: "bg-emerald-500 text-white ring-1 ring-emerald-600/40 dark:bg-emerald-500/80 dark:text-emerald-50",
  },
  HALF: {
    soft: "bg-teal-100 text-teal-950 ring-1 ring-teal-300/70 dark:bg-teal-500/20 dark:text-teal-100 dark:ring-teal-400/30",
    bold: "bg-teal-500 text-white ring-1 ring-teal-600/40 dark:bg-teal-500/80 dark:text-teal-50",
  },
  QUARTER: {
    soft: "bg-cyan-100 text-cyan-950 ring-1 ring-cyan-300/70 dark:bg-cyan-500/20 dark:text-cyan-100 dark:ring-cyan-400/30",
    bold: "bg-cyan-500 text-white ring-1 ring-cyan-600/40 dark:bg-cyan-500/80 dark:text-cyan-50",
  },
};

const NEUTRAL: KindStyle = {
  soft: "bg-accent text-accent-foreground ring-1 ring-border",
  bold: "bg-slate-500 text-white ring-1 ring-slate-600/40 dark:bg-slate-600/80 dark:text-slate-50",
};

export function kindClass(kind: string, intensity: Intensity): string {
  return (KIND_STYLES[kind] ?? NEUTRAL)[intensity];
}

// status → 오버레이(형태). 색과 직교(D5). PENDING=점선, REJECTED/CANCELLED=취소선+흐림.
export function statusOverlay(status?: EventStatus | null): string {
  if (status === "PENDING") return "border border-dashed border-current";
  if (status === "REJECTED" || status === "CANCELLED") return "line-through opacity-60";
  return "";
}

// 호출부가 색+오버레이를 한 번에 합칠 때 사용(편의). 미사용 시 트리 셰이킹.
export function eventChipClass(kind: string, intensity: Intensity, status?: EventStatus | null): string {
  return cn(kindClass(kind, intensity), statusOverlay(status));
}
