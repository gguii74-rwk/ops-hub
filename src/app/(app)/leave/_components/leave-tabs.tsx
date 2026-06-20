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

// 개별 컴포넌트로 분리 — useCan을 map 루프 안에서 직접 호출하면 react-hooks 규칙 위반.
function Tab({ tab, pathname }: { tab: TabDef; pathname: string }) {
  const allowed = useCan(tab.resource, tab.action);
  if (!allowed) return null;
  const active =
    tab.href === "/leave"
      ? pathname === "/leave"
      : pathname.startsWith(tab.href);
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-full px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
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
