# task-05 — AppNav 2단 아코디언

**목적:** 사이드바를 평면→2단 아코디언으로 렌더한다(D5). 링크/토글 판정·자동 펼침 로직을 순수 함수 `computeNavRows`로 추출(DOM 없이 단위테스트 — 이 저장소 컴포넌트 테스트 관행), JSX는 얇게 유지. a11y(`aria-expanded`/`aria-controls`, `prefers-reduced-motion`).

## Files

- **Modify:** `src/app/(app)/app-nav.tsx` — `NavItem`에 children; `computeNavRows`/`isActiveHref` export; 아코디언 렌더.
- **Create (test):** `tests/app/nav/compute-nav-rows.test.ts`(순수).

## Prep

- 스펙 §6(`AppNav` 절), 결정 D5.
- 엔트리포인트 §Shared Contracts **SC-2**(`NavNode`·href 인코딩 규칙 — 링크/토글은 `href != null`로 판정).
- 기존 출처: `src/app/(app)/app-nav.tsx`(현재 평면 렌더·`NAV_TONES`), `src/app/(app)/admin/_components/admin-tabs.tsx`(per-item child 컴포넌트로 hook 순서 안정화 패턴), `src/app/(app)/layout.tsx:36`(`<AppNav items={nav}/>` 소비처).

## Deps

task-04(`NavNode.children` + `loadNavigation`이 children·href 인코딩을 내려보냄).

## Cautions

- **권한으로 링크/토글을 판정하지 말 것** — 클라이언트엔 권한 정보가 없다. **`href != null`이면 링크, `null`이면 토글**(SC-2 인코딩 규칙. 서버 `selectVisibleNav`가 이미 자체 권한 실패 부모의 href를 null로 내려보냄).
- **자동 펼침(D5):** 현재 경로가 자식 href(또는 그 하위)면 그 부모는 펼친다. `expanded = open || activeChild` — **활성 자식이 있는 섹션은 접히지 않는다**(의도: 현재 위치한 섹션 유지). localStorage 펼침 기억은 미포함(YAGNI — D5).
- **hook 순서 안정화:** 부모 행마다 `useState`/`useId`를 쓰므로 **per-row 자식 컴포넌트로 분리**(admin-tabs `Tab` 패턴). `items.map` 안에서 직접 hook 호출 금지.
- **layout.tsx는 무수정** — `loadNavigation`이 children 포함 `NavNode[]`를 반환하고 `AppNav`가 그대로 받는다.
- 3단 렌더 금지(D6) — 자식은 항상 leaf. `row.children`만 그린다.

## Step 1 — 실패 테스트: computeNavRows 순수 로직

`tests/app/nav/compute-nav-rows.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import { computeNavRows, isActiveHref } from "@/app/(app)/app-nav";

type NavItem = { key: string; label: string; href: string | null; children: NavItem[] };
const leaf = (key: string, href: string | null): NavItem => ({ key, label: key, href, children: [] });

describe("isActiveHref", () => {
  it("정확 일치·하위 경로는 active, null·무관 경로는 아님", () => {
    expect(isActiveHref("/admin", "/admin")).toBe(true);
    expect(isActiveHref("/admin", "/admin/navigation")).toBe(true);
    expect(isActiveHref("/admin", "/dashboard")).toBe(false);
    expect(isActiveHref(null, "/admin")).toBe(false);
    expect(isActiveHref("/admin", "/administrators")).toBe(false); // prefix 오탐 방지(슬래시 경계)
  });
});

describe("computeNavRows (D5 링크/토글·자동펼침)", () => {
  const items: NavItem[] = [
    leaf("dashboard", "/dashboard"),
    { key: "admin", label: "관리", href: null, children: [leaf("admin-navigation", "/admin/navigation")] }, // 토글 부모
    { key: "leave", label: "연차", href: "/leave", children: [leaf("leave-status", "/leave/status")] },     // 링크 부모
  ];

  it("href 있는 노드는 링크, null이면 토글", () => {
    const rows = computeNavRows(items, "/dashboard");
    expect(rows.find((r) => r.key === "dashboard")!.isLink).toBe(true);
    expect(rows.find((r) => r.key === "admin")!.isLink).toBe(false);
    expect(rows.find((r) => r.key === "leave")!.isLink).toBe(true);
  });

  it("현재 경로가 자식이면 부모 active + 자동 펼침, 자식 active 표시", () => {
    const rows = computeNavRows(items, "/admin/navigation");
    const admin = rows.find((r) => r.key === "admin")!;
    expect(admin.active).toBe(true);
    expect(admin.autoExpanded).toBe(true);
    expect(admin.children.find((c) => c.key === "admin-navigation")!.active).toBe(true);
  });

  it("무관 경로면 부모 비활성·미펼침", () => {
    const rows = computeNavRows(items, "/dashboard");
    const admin = rows.find((r) => r.key === "admin")!;
    expect(admin.active).toBe(false);
    expect(admin.autoExpanded).toBe(false);
  });
});
```

실행: `npm test -- compute-nav-rows` → **FAIL**.

## Step 2 — app-nav.tsx 재작성

`src/app/(app)/app-nav.tsx` 전체 교체. `NAV_TONES`/`DEFAULT_TONE`/`NavTone`은 기존 값 보존, 그 아래에 순수 함수와 아코디언 렌더 추가:

```tsx
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
```

실행: `npm test -- compute-nav-rows` → **PASS**.

## Acceptance Criteria

- `npm test -- compute-nav-rows` → PASS.
- `npm run typecheck` → 0 errors(`layout.tsx`가 children 포함 `NavNode[]`를 `AppNav`에 전달, 타입 일치).
- `npm run lint` → 0 errors.
- `npm run build` → 성공(클라이언트 컴포넌트 컴파일).
- `git diff src/app/(app)/layout.tsx` → 무변경.
