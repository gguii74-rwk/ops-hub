import * as React from "react";
import { cn } from "@/lib/utils";

export type ChipTone =
  | "ok" | "off" | "blue" | "amber" | "purple" | "orange" | "pink" | "rose" | "neutral";

// 채움형 컬러칩. Tailwind 기본 팔레트(50/700) + 다크 변형. 정적 리터럴(JIT 스캔 안전).
const TONE: Record<ChipTone, string> = {
  ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  off: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  purple: "bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
  orange: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  pink: "bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  neutral: "bg-muted text-muted-foreground",
};

export function Chip({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: ChipTone }) {
  return (
    <span
      data-slot="chip"
      className={cn(
        "inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}
