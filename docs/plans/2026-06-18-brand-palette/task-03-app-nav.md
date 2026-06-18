# task-03 — AppNav client + 활성 pill + 워드마크

**목적:** 현재 경로를 알아야 하는 활성 nav pill을 위해 nav 렌더를 client 컴포넌트 `AppNav`로 분리하고, `(app)/layout.tsx`가 이를 사용하도록 교체한다. 사이드바 워드마크에 `font-display` 적용.

## Files

- **Create:** `src/app/(app)/app-nav.tsx` — `"use client"` nav 렌더, 활성 pill
- **Modify:** `src/app/(app)/layout.tsx` — `<nav>{...}</nav>` → `<AppNav items={nav} />`, 워드마크 `font-display`, 미사용 `Link` import 제거

## Prep

- spec §7(파일 변경, "nav client 분리 상세")
- 엔트리포인트 §Shared Contracts "`AppNav` 시그니처"
- 현재 `src/app/(app)/layout.tsx`(server, `loadNavigation` → `nav.map`으로 `<Link>` 렌더). client colocate 선례: `src/app/(app)/admin/settings/settings-editor.tsx`.

## Deps

01(accent 토큰으로 pill 색), 02(워드마크 `font-display`).

## Steps (프레젠테이션 — 자동 테스트 없음, 게이트 + 스모크로 검증)

### 1. AppNav client 컴포넌트 생성

`src/app/(app)/app-nav.tsx` 생성:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// NavNode와 구조 동일이지만 kernel(server-only) import을 피하려 로컬 정의한다.
type NavItem = { key: string; label: string; href: string | null };

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="grid gap-1">
      {items.map((item) => {
        const href = item.href ?? "#";
        const active =
          item.href != null &&
          (pathname === item.href || pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

### 2. (app)/layout.tsx 교체

`src/app/(app)/layout.tsx`를 다음으로 만든다. 변경점은 ①`Link` import 제거 + `AppNav` import 추가, ②워드마크에 `font-display`, ③`<nav>...</nav>` → `<AppNav items={nav} />`. 인증·권한·서버 로직은 **무변경**.

```tsx
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { loadNavigation } from "@/kernel/navigation";
import { PermissionProvider } from "@/lib/auth/permissions-client";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AppNav } from "./app-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const summary = await getPermissionSummary(session.user.id);
  const nav = await loadNavigation(summary.keys);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <PermissionProvider keys={summary.keys}>
      <div className="grid min-h-screen grid-cols-[200px_1fr]">
        <aside className="flex flex-col gap-4 border-r border-border bg-card p-4">
          <strong className="font-display text-lg font-semibold tracking-tight">ops-hub</strong>
          <AppNav items={nav} />
          <div className="mt-auto flex items-center justify-between">
            <form action={logout}>
              <Button type="submit" variant="ghost" size="sm">
                로그아웃
              </Button>
            </form>
            <ThemeSwitcher />
          </div>
        </aside>
        <main className="p-6">
          <p className="mb-4 text-sm text-muted-foreground">
            {session.user.name} · {session.user.systemRole}
          </p>
          {children}
        </main>
      </div>
    </PermissionProvider>
  );
}
```

### 3. 게이트 + 스모크

```bash
npm run typecheck
npm run lint        # boundaries 포함 — app-nav는 app element라 통과해야 함
npm run build
```

수동 스모크(dev 기동 후 로그인): 현재 경로의 메뉴가 라벤더 pill(`bg-accent`)로 강조되고 `aria-current="page"`가 붙는지, 다른 메뉴 hover 시 `hover:bg-muted`가 도는지, 워드마크 `ops-hub`가 Playfair(세리프)로 렌더되는지.

### 4. 커밋

```bash
git add "src/app/(app)/app-nav.tsx" "src/app/(app)/layout.tsx"
git commit -m "Split nav into client AppNav with active pill; Playfair sidebar wordmark"
```

## Acceptance Criteria

```bash
npm run typecheck   # 에러 없음
npm run lint        # 에러 없음(boundaries 통과 — eslint.config 변경 불필요)
npm run build       # 성공
npm test            # 회귀 없음
```

- `app-nav.tsx`가 `"use client"`이고 `NavItem`을 로컬 정의(`@/kernel/navigation` import 없음).
- `(app)/layout.tsx`에 `import Link from "next/link"`가 더 이상 없고(미사용), `<AppNav items={nav} />` 사용.
- 워드마크에 `font-display` 적용.

## Cautions

- **`app-nav.tsx`에서 `@/kernel/navigation`의 `NavNode`를 import하지 말 것.** 이유: kernel 모듈은 `@/lib/prisma`(server-only)를 끌고 와 client 번들을 오염시킨다. 구조 동일한 `NavItem`을 로컬 정의하면 `nav: NavNode[]`가 그대로 호환된다.
- **`(app)/layout.tsx`의 인증·권한 흐름(`auth`/`getPermissionSummary`/`loadNavigation`/`PermissionProvider`)을 바꾸지 말 것.** 이유: 이 패스는 순수 프레젠테이션. 권한 로직 변경은 범위 밖.
- **`Link` import를 남겨두지 말 것.** 이유: nav 렌더가 AppNav로 빠지면 layout에서 `Link`가 미사용 → eslint(no-unused-vars)/Next lint 실패.
- **eslint.config.mjs를 수정하지 말 것.** 이유: `app-nav.tsx`는 `src/app`(app element)이고 `app → ui/lib` 허용 규칙 안. `next/*`는 외부 모듈이라 boundaries 미적용 → 경계 변경 불필요.
