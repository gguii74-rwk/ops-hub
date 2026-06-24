import * as React from "react";
import { cn } from "@/lib/utils";

const WIDTH: Record<"full" | "form" | "wide", string> = {
  full: "",
  form: "mx-auto w-full max-w-lg",
  wide: "mx-auto w-full max-w-2xl",
};

function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function PageSection({
  title,
  subtitle,
  actions,
  width = "full",
  className,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  width?: "full" | "form" | "wide";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("space-y-4", WIDTH[width], className)}>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      {children}
    </section>
  );
}
export { PageHeader, PageSection };
