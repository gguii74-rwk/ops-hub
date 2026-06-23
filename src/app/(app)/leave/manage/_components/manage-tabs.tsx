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
  { href: "/leave/manage", label: "연차 승인", resource: "leave.approval", action: "view" },
  { href: "/leave/manage/allocations", label: "연차 할당", resource: "leave.allocation", action: "view" },
  { href: "/leave/manage/status", label: "연차 현황", resource: "leave.status", action: "view" },
];

// 개별 컴포넌트로 분리 — useCan을 map 루프 안에서 직접 호출하면 react-hooks 규칙 위반(LeaveTabs 패턴 계승).
function Tab({ tab, pathname }: { tab: TabDef; pathname: string }) {
  const allowed = useCan(tab.resource, tab.action);
  if (!allowed) return null;
  // 인덱스 탭(승인)=정확 일치, 나머지=하위 경로 포함.
  const active = tab.href === "/leave/manage" ? pathname === "/leave/manage" : pathname.startsWith(tab.href);
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-all",
        active
          ? "border-nav-leave/40 bg-nav-leave/15 font-semibold text-emerald-800 shadow-sm dark:text-emerald-100"
          : "border-transparent text-muted-foreground hover:border-nav-leave/30 hover:bg-nav-leave/10 hover:text-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full bg-nav-leave", active ? "opacity-100" : "opacity-60")}
      />
      {tab.label}
    </Link>
  );
}

export function ManageTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border pb-2">
      {TABS.map((tab) => (
        <Tab key={tab.href} tab={tab} pathname={pathname} />
      ))}
    </nav>
  );
}
