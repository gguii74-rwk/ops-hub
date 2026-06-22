"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";

import { cn } from "@/lib/utils";

// NavNode와 구조 동일이지만 kernel(server-only) import을 피하려 로컬 정의한다.
type NavItem = { key: string; label: string; href: string | null; children: NavItem[] };

type NavTone = {
  dot: string;
  active: string;
  hover: string;
};

const NAV_TONES: Record<string, NavTone> = {
  dashboard: {
    dot: "bg-nav-dashboard",
    active: "border-nav-dashboard/40 bg-nav-dashboard/15 text-blue-800 dark:text-blue-100",
    hover: "hover:border-nav-dashboard/30 hover:bg-nav-dashboard/10",
  },
  calendar: {
    dot: "bg-nav-calendar",
    active: "border-nav-calendar/40 bg-nav-calendar/15 text-cyan-800 dark:text-cyan-100",
    hover: "hover:border-nav-calendar/30 hover:bg-nav-calendar/10",
  },
  workflows: {
    dot: "bg-nav-workflows",
    active: "border-nav-workflows/40 bg-nav-workflows/15 text-orange-800 dark:text-orange-100",
    hover: "hover:border-nav-workflows/30 hover:bg-nav-workflows/10",
  },
  leave: {
    dot: "bg-nav-leave",
    active: "border-nav-leave/40 bg-nav-leave/15 text-emerald-800 dark:text-emerald-100",
    hover: "hover:border-nav-leave/30 hover:bg-nav-leave/10",
  },
  admin: {
    dot: "bg-nav-admin",
    active: "border-nav-admin/40 bg-nav-admin/15 text-fuchsia-800 dark:text-fuchsia-100",
    hover: "hover:border-nav-admin/30 hover:bg-nav-admin/10",
  },
};

const DEFAULT_TONE: NavTone = {
  dot: "bg-brand",
  active: "border-brand/40 bg-brand/15 text-blue-800 dark:text-blue-100",
  hover: "hover:border-brand/30 hover:bg-brand/10",
};

// 경로가 이 href(또는 그 하위)인가. 슬래시 경계로 prefix 오탐 방지(/admin ≠ /administrators).
export function isActiveHref(href: string | null, pathname: string): boolean {
  if (href == null) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface NavChildRow {
  key: string;
  label: string;
  href: string | null;
  active: boolean;
}
export interface NavRow {
  key: string;
  label: string;
  href: string | null;
  isLink: boolean;       // href != null (SC-2 인코딩)
  active: boolean;       // 자신 또는 자식이 현재 경로
  autoExpanded: boolean; // 자신 또는 자식이 활성 → 펼침
  children: NavChildRow[];
}

// 렌더 결정을 순수 계산으로 분리(DOM 없이 테스트). 펼침 토글은 컴포넌트 상태가 보강.
export function computeNavRows(items: NavItem[], pathname: string): NavRow[] {
  return items.map((item) => {
    const children: NavChildRow[] = item.children.map((c) => ({
      key: c.key, label: c.label, href: c.href, active: isActiveHref(c.href, pathname),
    }));
    const selfActive = isActiveHref(item.href, pathname);
    const childActive = children.some((c) => c.active);
    return {
      key: item.key, label: item.label, href: item.href,
      isLink: item.href != null,
      active: selfActive || childActive,
      autoExpanded: selfActive || childActive,
      children,
    };
  });
}

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const rows = computeNavRows(items, pathname);
  return (
    <nav className="grid gap-1.5">
      {rows.map((row) => (
        <NavRowView key={row.key} row={row} />
      ))}
    </nav>
  );
}

// per-row 컴포넌트 — useState/useId 순서 안정화(admin-tabs Tab 패턴).
function NavRowView({ row }: { row: NavRow }) {
  const tone = NAV_TONES[row.key] ?? DEFAULT_TONE;
  const hasChildren = row.children.length > 0;
  const panelId = useId();
  const [open, setOpen] = useState(row.autoExpanded);
  // 활성 자식이 있으면 항상 펼침(경로 이동에 따른 자동 펼침 — 현재 섹션은 접히지 않음).
  const expanded = open || row.children.some((c) => c.active);

  const headerClasses = (active: boolean) =>
    cn(
      "flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all",
      active
        ? cn("font-semibold shadow-sm", tone.active)
        : cn("border-transparent text-muted-foreground hover:text-foreground", tone.hover),
    );
  const dot = (active: boolean, size = "size-2") => (
    <span aria-hidden className={cn(size, "rounded-full", tone.dot, active ? "opacity-100" : "opacity-60")} />
  );

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-1">
        {row.isLink ? (
          <Link href={row.href!} aria-current={row.active ? "page" : undefined} className={headerClasses(row.active)}>
            {dot(row.active)}
            {row.label}
          </Link>
        ) : (
          <button
            type="button"
            className={headerClasses(row.active)}
            aria-expanded={hasChildren ? expanded : undefined}
            aria-controls={hasChildren ? panelId : undefined}
            onClick={() => hasChildren && setOpen((v) => !v)}
          >
            {dot(row.active)}
            {row.label}
          </button>
        )}
        {hasChildren && (
          <button
            type="button"
            aria-label={`${row.label} 하위 메뉴 ${expanded ? "접기" : "펼치기"}`}
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            className="rounded-md px-1.5 py-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <span aria-hidden className={cn("inline-block transition-transform motion-reduce:transition-none", expanded && "rotate-90")}>
              ›
            </span>
          </button>
        )}
      </div>
      {hasChildren && expanded && (
        <ul id={panelId} className="ml-4 grid gap-1 border-l border-border pl-2">
          {row.children.map((c) => (
            <li key={c.key}>
              <Link
                href={c.href ?? "#"}
                aria-current={c.active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-all",
                  c.active
                    ? cn("font-semibold", tone.active)
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {dot(c.active, "size-1.5")}
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
