# 디자인 시스템 기반 — 구현 계획 (엔트리포인트)

- **Feature:** Design System Foundation (Tailwind v4 토큰 + 프리미티브 + 앱 셸 + 기존 화면 마이그레이션)
- **Goal:** 도메인 화면을 본격적으로 쌓기 전에 공통 토큰·프리미티브·앱 셸을 깔고 login·셸·settings를 그것으로 마이그레이션한다.
- **Architecture:** Tailwind v4 CSS-first(`@theme` in `globals.css`) + native element + `cva` + `cn` 프리미티브(`src/components/ui`) + next-themes/sonner. eslint-plugin-boundaries에 `ui` element 추가로 의존 방향 강제.
- **Tech Stack:** Next 16(App Router, Turbopack) · React 19 · Tailwind v4 · class-variance-authority · clsx · tailwind-merge · next-themes · sonner · lucide-react.
- **Spec:** `docs/specs/2026-06-18-design-system-foundation-design.md`

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-18-design-system-foundation/task-NN-<slug>.md`). Task bodies (Files, steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

## 검증 정책 (이 plan의 TDD 예외)

UI/CSS는 자동 테스트 인프라를 **이번에도 도입하지 않는다**(스펙 §10, Phase 1·2 정책 동일). 따라서 대부분 태스크의 검증 게이트는 **`npm run typecheck` · `npm run lint`(boundaries 포함) · `npm run build`** + 명시된 **수동 스모크**다. 자동 테스트가 가능한 단위(`cn` 헬퍼)는 vitest로 TDD한다. 기존 92개 테스트는 전 태스크에서 회귀가 없어야 한다(`npm test`).

## Shared Contracts

### deps (task-01에서 설치)

```
npm i tailwind-merge next-themes sonner
npm i -D tailwindcss @tailwindcss/postcss
```

`class-variance-authority`·`clsx`·`lucide-react`는 이미 존재. `@base-ui/react`는 이번에 **도입하지 않는다**(7종 프리미티브에 import 없음).

### `cn` (task-01에서 생성: `src/lib/utils.ts`)

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

모든 프리미티브는 `import { cn } from "@/lib/utils"`만 참조한다(단방향).

### 토큰 이름 (task-01에서 `globals.css @theme`에 정의 — 프리미티브/화면이 유틸로 소비)

- 코어 시맨틱 색 19개(`--color-*`): `background` `foreground` `card` `card-foreground` `popover` `popover-foreground` `primary` `primary-foreground` `secondary` `secondary-foreground` `muted` `muted-foreground` `accent` `accent-foreground` `destructive` `destructive-foreground` `border` `input` `ring`
- 앱 배경: `--color-page`
- radius: `--radius-sm` `--radius-md` `--radius-lg` `--radius-xl`
- dark variant: `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *))`, 값은 `@layer base [data-theme="dark"]`

실제 oklch/hex 값은 task-01에 full로 인라인.

### 경계 룰 (task-02에서 `eslint.config.mjs` 적용)

`boundaries/elements`에 추가:
```js
{ type: "ui", pattern: "src/components", mode: "folder" }
```
`boundaries/element-types` rules:
```js
{ from: ["ui"],  allow: ["ui", "lib"] }                                // 신규
{ from: ["app"], allow: ["app", "kernel", "lib", "module", "ui"] }     // 기존 app 규칙에 "ui" 추가
```
`module → ui`는 추가하지 않는다(보류). 도메인 화면 client 컴포넌트는 `src/app/...`에 colocate.

### 프리미티브 export 시그니처 (task-02·03에서 생성, 이후 태스크가 import)

```ts
// @/components/ui/button
function Button(props: React.ComponentProps<"button"> & { variant?: "default"|"outline"|"secondary"|"ghost"|"destructive"|"link"; size?: "default"|"sm"|"lg"|"icon" }): JSX.Element
export { Button, buttonVariants }

// @/components/ui/input
function Input(props: React.ComponentProps<"input">): JSX.Element
export { Input }

// @/components/ui/textarea
function Textarea(props: React.ComponentProps<"textarea">): JSX.Element
export { Textarea }

// @/components/ui/label
function Label(props: React.ComponentProps<"label">): JSX.Element
export { Label }

// @/components/ui/card
export { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter }
// 각각 React.ComponentProps<"div">; Card는 추가로 { size?: "default"|"sm" }

// @/components/ui/badge
function Badge(props: React.ComponentProps<"span"> & { variant?: "default"|"secondary"|"destructive"|"outline"|"ghost"|"link" }): JSX.Element
export { Badge, badgeVariants }

// @/components/ui/separator
function Separator(props: React.ComponentProps<"div"> & { orientation?: "horizontal"|"vertical" }): JSX.Element
export { Separator }
```

### 테마 · 토스트 계약 (task-04에서 생성)

```ts
// @/components/theme-provider — "use client", next-themes
//   attribute="data-theme", themes=["light","dark"], defaultTheme="light", enableSystem={false}
export function ThemeProvider({ children }: { children: React.ReactNode }): JSX.Element

// @/components/themed-toaster — "use client", sonner Toaster richColors position="top-right", 테마 연동
export function ThemedToaster(): JSX.Element

// @/components/theme-switcher — "use client", Button(ghost/icon) + lucide Sun/Moon, light↔dark 토글
export function ThemeSwitcher(): JSX.Element
```

토스트 호출은 `import { toast } from "sonner"` — `toast.success(...)` / `toast.error(...)`.

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | Tailwind 토대 + 토큰 + cn | [ ] | [task-01](2026-06-18-design-system-foundation/task-01-tailwind-foundation.md) | — | |
| 02 | 경계(ui element) + 프리미티브 4종 | [ ] | [task-02](2026-06-18-design-system-foundation/task-02-primitives-core.md) | 01 | |
| 03 | 프리미티브 3종 (card/badge/separator) | [ ] | [task-03](2026-06-18-design-system-foundation/task-03-primitives-display.md) | 01, 02 | |
| 04 | 테마/토스트 인프라 + root layout | [ ] | [task-04](2026-06-18-design-system-foundation/task-04-theme-toast-shell.md) | 02 | |
| 05 | 앱 셸 (app)/layout 마이그레이션 | [ ] | [task-05](2026-06-18-design-system-foundation/task-05-app-shell.md) | 02, 04 | |
| 06 | login 마이그레이션 | [ ] | [task-06](2026-06-18-design-system-foundation/task-06-login.md) | 02, 03 | |
| 07 | settings + admin 마이그레이션 + 최종 검증 | [ ] | [task-07](2026-06-18-design-system-foundation/task-07-settings-admin.md) | 02, 03, 04 | |
