# Task 05 — 앱 셸 (app)/layout 마이그레이션

`src/app/(app)/layout.tsx`의 인라인 스타일 사이드바를 Tailwind + 프리미티브로 교체하고 테마 토글을 추가한다.

## Files
- Modify: `src/app/(app)/layout.tsx`

## Prep
- 스펙 §8(마이그레이션 표)
- 엔트리포인트 §Shared Contracts: Button, ThemeSwitcher
- 현재 파일은 인라인 `style={{...}}`로 `grid`/`aside`/`nav`/`form`을 그린다. 로직(`auth`/`getPermissionSummary`/`loadNavigation`/`logout` server action/`PermissionProvider`)은 **그대로 유지**하고 마크업만 교체한다.

## Deps
- task-02 (Button)
- task-04 (ThemeSwitcher)

## Steps

### 1. (app)/layout.tsx 교체
파일 전체를 다음으로 교체한다.
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { loadNavigation } from "@/kernel/navigation";
import { PermissionProvider } from "@/lib/auth/permissions-client";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";

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
          <strong className="text-sm font-semibold">ops-hub</strong>
          <nav className="grid gap-1">
            {nav.map((node) => (
              <Link
                key={node.key}
                href={node.href ?? "#"}
                className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {node.label}
              </Link>
            ))}
          </nav>
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

### 2. 검증 + 커밋
```
npm run lint
npm run typecheck
npm run build
git add "src/app/(app)/layout.tsx"
git commit -m "Migrate app shell to Tailwind with theme switcher"
```

## Acceptance Criteria
- `npm run lint` → 0 errors. 특히 `app → ui`(Button, ThemeSwitcher) import가 경계 규칙으로 허용돼야 한다.
- `npm run typecheck` → 0 errors
- `npm run build` → 성공
- `npm test` → 기존 테스트 회귀 없음
- 수동 스모크(dev 서버): 로그인 후 셸이 렌더되고, 좌하단 토글로 light↔dark가 즉시 전환되며 사이드바/본문 색이 따라 바뀐다.

## Cautions
- **`logout` server action과 `PermissionProvider` 래핑을 제거하거나 변경하지 말 것.** Reason: 인증/권한 동작은 이번 작업 범위 밖이다. 마크업만 교체한다.
- **`ThemeSwitcher`(client)를 server layout에서 import하는 것은 정상.** Reason: 서버 컴포넌트는 client 컴포넌트를 자식으로 렌더할 수 있다.
