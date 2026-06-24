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
  active: boolean;            // 자신 또는 자식이 현재 경로
  targetHref: string | null;  // 헤더 클릭 시 이동 — 자식 있으면 첫 자식(첫 중메뉴), 없으면 자기 href
  children: NavChildRow[];
}

// 렌더 결정을 순수 계산으로 분리(DOM 없이 테스트). 펼침 상태는 AppNav가 보강(단일 확장 아코디언).
export function computeNavRows(items: NavItem[], pathname: string): NavRow[] {
  return items.map((item) => {
    // 형제 중 현재 경로와 매칭되는 "가장 긴(구체적) href"만 active(D8).
    // 인덱스 자식(예: 대시보드 /leave)이 형제 하위경로(/leave/request)에서 prefix로 잡히는 충돌 방지.
    const matchLen = item.children.reduce(
      (max, c) => (isActiveHref(c.href, pathname) ? Math.max(max, c.href!.length) : max),
      0,
    );
    const children: NavChildRow[] = item.children.map((c) => ({
      key: c.key, label: c.label, href: c.href,
      active: isActiveHref(c.href, pathname) && c.href!.length === matchLen,
    }));
    const selfActive = isActiveHref(item.href, pathname);
    const childActive = children.some((c) => c.active);
    return {
      key: item.key, label: item.label,
      active: selfActive || childActive,
      // 부모 클릭 = 첫 중메뉴로 이동(부모 href가 placeholder인 경우 대비). leaf는 자기 href.
      targetHref: item.children[0]?.href ?? item.href,
      children,
    };
  });
}

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const rows = computeNavRows(items, pathname);
  // 펼칠 섹션 — 활성이고 자식 있는 부모(아코디언은 한 번에 하나만 펼침).
  const activeKey = rows.find((r) => r.active && r.children.length > 0)?.key ?? null;
  const [expandedKey, setExpandedKey] = useState<string | null>(activeKey);
  const [syncedPath, setSyncedPath] = useState(pathname);
  // 경로가 바뀌면 활성 섹션으로 펼침을 옮긴다(이전 섹션은 닫힘). 표준 파생-상태 패턴(렌더 중 setState).
  if (syncedPath !== pathname) {
    setSyncedPath(pathname);
    setExpandedKey(activeKey);
  }
  return (
    <nav className="grid gap-1.5">
      {rows.map((row) => (
        <NavRowView
          key={row.key}
          row={row}
          expanded={row.key === expandedKey}
          onToggle={() => setExpandedKey((k) => (k === row.key ? null : row.key))}
        />
      ))}
    </nav>
  );
}

// per-row 컴포넌트 — useId 순서 안정화(admin-tabs Tab 패턴). 펼침은 상위 단일 상태가 주입.
function NavRowView({ row, expanded, onToggle }: { row: NavRow; expanded: boolean; onToggle: () => void }) {
  const tone = NAV_TONES[row.key] ?? DEFAULT_TONE;
  const hasChildren = row.children.length > 0;
  const panelId = useId();

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
        {row.targetHref ? (
          <Link href={row.targetHref} aria-current={row.active ? "page" : undefined} className={headerClasses(row.active)}>
            {dot(row.active)}
            {row.label}
          </Link>
        ) : (
          <span className={headerClasses(row.active)}>
            {dot(row.active)}
            {row.label}
          </span>
        )}
        {hasChildren && (
          <button
            type="button"
            aria-label={`${row.label} 하위 메뉴 ${expanded ? "접기" : "펼치기"}`}
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
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
