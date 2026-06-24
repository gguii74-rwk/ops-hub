import * as React from "react";
import { cn } from "@/lib/utils";

export function StatStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap gap-2", className)}>{children}</div>;
}

export function Stat({
  value,
  label,
  accent,
  onClick,
  className,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  accent?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const cls = cn(
    "min-w-[88px] rounded-xl border px-3.5 py-2 text-left",
    accent ? "border-ring/30 bg-secondary" : "border-border bg-card",
    onClick && "transition-colors hover:border-ring/50",
    className,
  );
  const body = (
    <>
      <div className={cn("text-lg font-bold tabular-nums", accent && "text-accent-foreground")}>{value}</div>
      <div className="text-[11.5px] text-muted-foreground">{label}</div>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
