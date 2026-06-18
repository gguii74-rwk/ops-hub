# Task 04 — 테마/토스트 인프라 + root layout

next-themes provider, sonner toaster, light↔dark 토글, root layout 래핑을 만든다.

## Files
- Create: `src/components/theme-provider.tsx`, `src/components/themed-toaster.tsx`, `src/components/theme-switcher.tsx`
- Modify: `src/app/layout.tsx`

## Prep
- 스펙 §7
- 엔트리포인트 §Shared Contracts: 테마·토스트 계약, 프리미티브(Button)
- 참조: `D:/workspace/day-sync/src/components/{theme-provider,themed-toaster,theme-switcher}.tsx` — provider/toaster는 거의 그대로(단 themes는 2개), theme-switcher는 day-sync가 DropdownMenu 3테마이므로 **단순 토글로 새로 작성**.

## Deps
- task-02 (Button)

## Steps

### 1. theme-provider.tsx
```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="light"
      themes={["light", "dark"]}
      enableSystem={false}
    >
      {children}
    </NextThemesProvider>
  );
}
```

### 2. themed-toaster.tsx
```tsx
"use client";

import { useTheme } from "next-themes";
import { Toaster } from "sonner";

export function ThemedToaster() {
  const { theme } = useTheme();

  return (
    <Toaster
      richColors
      position="top-right"
      theme={theme === "dark" ? "dark" : "light"}
    />
  );
}
```

### 3. theme-switcher.tsx — 단순 light↔dark 토글
```tsx
"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

export function ThemeSwitcher() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- next-themes 공식 하이드레이션 패턴
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" disabled aria-label="테마 전환">
        <Sun className="size-4" />
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="테마 전환"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </Button>
  );
}
```

### 4. root layout 래핑 — `src/app/layout.tsx`
파일 전체를 교체한다.
```tsx
import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemedToaster } from "@/components/themed-toaster";

export const metadata: Metadata = {
  title: "ops-hub",
  description: "내부 업무 운영 허브",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen bg-page text-foreground antialiased">
        <ThemeProvider>
          {children}
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

### 5. 검증 + 커밋
```
npm run lint
npm run typecheck
npm run build
git add src/components/theme-provider.tsx src/components/themed-toaster.tsx src/components/theme-switcher.tsx src/app/layout.tsx
git commit -m "Add theme provider, toaster, switcher and wrap root layout"
```

## Acceptance Criteria
- `npm run lint` → 0 errors (ui→ui: switcher→Button, ui→외부 npm 무관)
- `npm run typecheck` → 0 errors
- `npm run build` → 성공
- `npm test` → 기존 테스트 회귀 없음

## Cautions
- **root `<html>`에 `suppressHydrationWarning`을 반드시 둘 것.** Reason: next-themes가 클라이언트에서 `data-theme`를 주입하므로 서버/클라이언트 마크업이 달라 hydration 경고가 난다.
- **theme-switcher의 `mounted` 가드를 제거하지 말 것.** Reason: 마운트 전 테마는 알 수 없어 hydration mismatch가 발생한다.
- step 3의 `eslint-disable` 주석이 "unused directive"로 보고되면(룰 미존재) 그 한 줄만 제거한다. Reason: day-sync(동일 eslint-config-next 16)에서는 필요했지만 환경 차이를 방어한다.
