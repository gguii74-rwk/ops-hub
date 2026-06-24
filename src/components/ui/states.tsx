import * as React from "react";
import { cn } from "@/lib/utils";

function LoadingState({ label = "불러오는 중…", className }: { label?: string; className?: string }) {
  return <p className={cn("text-sm text-muted-foreground", className)}>{label}</p>;
}

function ErrorState({
  message = "불러오지 못했습니다.",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return <p className={cn("text-sm text-destructive", className)}>{message}</p>;
}

function EmptyState({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-sm text-muted-foreground", className)}>
      <p>{children}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
export { LoadingState, ErrorState, EmptyState };
