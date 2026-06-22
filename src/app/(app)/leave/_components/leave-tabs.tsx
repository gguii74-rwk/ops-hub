"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCan } from "@/lib/auth/permissions-client";
import { cn } from "@/lib/utils";

interface TabDef {
  href: string;
  label: string;
  resource: string;
  action: string;
}

const TABS: TabDef[] = [
  { href: "/leave", label: "대시보드", resource: "leave.request", action: "view" },
  { href: "/leave/request", label: "연차 신청", resource: "leave.request", action: "create" },
  { href: "/leave/history", label: "연차 내역", resource: "leave.request", action: "view" },
  { href: "/leave/calendar", label: "캘린더", resource: "leave.request", action: "view" },
  { href: "/leave/approvals", label: "연차 승인", resource: "leave.approval", action: "view" },
  { href: "/leave/allocations", label: "연차 할당", resource: "leave.allocation", action: "view" },
  { href: "/leave/status", label: "연차 현황", resource: "leave.status", action: "view" },
];

type TabTone = {
  dot: string;
  active: string;
  hover: string;
};

const TAB_TONES: Record<string, TabTone> = {
  "/leave": {
    dot: "bg-nav-dashboard",
    active: "border-nav-dashboard/40 bg-nav-dashboard/15 text-blue-800 dark:text-blue-100",
    hover: "hover:border-nav-dashboard/30 hover:bg-nav-dashboard/10",
  },
  "/leave/request": {
    dot: "bg-nav-leave",
    active: "border-nav-leave/40 bg-nav-leave/15 text-emerald-800 dark:text-emerald-100",
    hover: "hover:border-nav-leave/30 hover:bg-nav-leave/10",
  },
  "/leave/history": {
    dot: "bg-nav-calendar",
    active: "border-nav-calendar/40 bg-nav-calendar/15 text-cyan-800 dark:text-cyan-100",
    hover: "hover:border-nav-calendar/30 hover:bg-nav-calendar/10",
  },
  "/leave/calendar": {
    dot: "bg-chart-cyan",
    active: "border-chart-cyan/40 bg-chart-cyan/15 text-cyan-800 dark:text-cyan-100",
    hover: "hover:border-chart-cyan/30 hover:bg-chart-cyan/10",
  },
  "/leave/approvals": {
    dot: "bg-nav-workflows",
    active: "border-nav-workflows/40 bg-nav-workflows/15 text-orange-800 dark:text-orange-100",
    hover: "hover:border-nav-workflows/30 hover:bg-nav-workflows/10",
  },
  "/leave/allocations": {
    dot: "bg-nav-admin",
    active: "border-nav-admin/40 bg-nav-admin/15 text-fuchsia-800 dark:text-fuchsia-100",
    hover: "hover:border-nav-admin/30 hover:bg-nav-admin/10",
  },
  "/leave/status": {
    dot: "bg-brand-2",
    active: "border-brand-2/40 bg-brand-2/15 text-rose-800 dark:text-rose-100",
    hover: "hover:border-brand-2/30 hover:bg-brand-2/10",
  },
};

// 개별 컴포넌트로 분리 — useCan을 map 루프 안에서 직접 호출하면 react-hooks 규칙 위반.
function Tab({ tab, pathname }: { tab: TabDef; pathname: string }) {
  const allowed = useCan(tab.resource, tab.action);
  if (!allowed) return null;
  const active =
    tab.href === "/leave"
      ? pathname === "/leave"
      : pathname.startsWith(tab.href);
  const tone = TAB_TONES[tab.href] ?? TAB_TONES["/leave"];
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-all",
        active
          ? cn("font-semibold shadow-sm", tone.active)
          : cn("border-transparent text-muted-foreground hover:text-foreground", tone.hover),
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", tone.dot, active ? "opacity-100" : "opacity-60")}
      />
      {tab.label}
    </Link>
  );
}

export function LeaveTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border pb-2">
      {TABS.map((tab) => (
        <Tab key={tab.href} tab={tab} pathname={pathname} />
      ))}
    </nav>
  );
}
