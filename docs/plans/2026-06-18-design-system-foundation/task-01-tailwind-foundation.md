# Task 01 — Tailwind 토대 + 토큰 + cn

Tailwind v4 빌드 토대(postcss), 디자인 토큰(`globals.css @theme`), `cn` 헬퍼를 깐다.

## Files
- Create: `postcss.config.mjs`, `src/lib/utils.ts`, `tests/lib/utils.test.ts`
- Modify: `package.json`(deps), `src/app/globals.css`

## Prep
- 스펙 §5(토큰), §9(deps·빌드)
- 엔트리포인트 §Shared Contracts: deps, cn, 토큰 이름

## Deps
없음.

## Steps

### 1. 의존성 설치
```
npm i tailwind-merge next-themes sonner
npm i -D tailwindcss @tailwindcss/postcss
```
검증: `package.json`의 dependencies에 `tailwind-merge`·`next-themes`·`sonner`, devDependencies에 `tailwindcss`·`@tailwindcss/postcss`가 추가됐는지 확인. `@base-ui/react`는 추가하지 않는다.

### 2. postcss.config.mjs 생성
```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

### 3. cn 헬퍼 (TDD)

**3a. 실패 테스트 작성 — `tests/lib/utils.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("공백으로 클래스를 합친다", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("충돌하는 tailwind 클래스는 뒤가 이긴다", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("falsy/조건 값은 무시한다", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});
```

**3b. 실행 → FAIL 확인**
```
npm test -- tests/lib/utils.test.ts
```
기대: `Cannot find module '@/lib/utils'` 또는 해석 실패.

**3c. 구현 — `src/lib/utils.ts`**
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**3d. 실행 → PASS 확인**
```
npm test -- tests/lib/utils.test.ts
```
기대: 3 passed.

**3e. 커밋**
```
git add src/lib/utils.ts tests/lib/utils.test.ts postcss.config.mjs package.json package-lock.json
git commit -m "Add Tailwind v4 build setup and cn helper"
```

### 4. globals.css를 Tailwind v4 토큰으로 전환 — `src/app/globals.css`
파일 전체를 다음으로 교체한다(기존 `:root`/`html,body` 블록 제거).
```css
@import "tailwindcss";

@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

@theme {
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.145 0 0);
  --color-card: oklch(1 0 0);
  --color-card-foreground: oklch(0.145 0 0);
  --color-popover: oklch(1 0 0);
  --color-popover-foreground: oklch(0.145 0 0);
  --color-primary: oklch(0.205 0 0);
  --color-primary-foreground: oklch(0.985 0 0);
  --color-secondary: oklch(0.97 0 0);
  --color-secondary-foreground: oklch(0.205 0 0);
  --color-muted: oklch(0.97 0 0);
  --color-muted-foreground: oklch(0.556 0 0);
  --color-accent: oklch(0.97 0 0);
  --color-accent-foreground: oklch(0.205 0 0);
  --color-destructive: oklch(0.577 0.245 27.325);
  --color-destructive-foreground: oklch(0.577 0.245 27.325);
  --color-border: oklch(0.922 0 0);
  --color-input: oklch(0.922 0 0);
  --color-ring: oklch(0.708 0 0);
  --color-page: oklch(0.985 0 0);

  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
}

@layer base {
  [data-theme="dark"] {
    --color-background: #0a0a0a;
    --color-foreground: #fafafa;
    --color-card: #171717;
    --color-card-foreground: #fafafa;
    --color-popover: #171717;
    --color-popover-foreground: #fafafa;
    --color-primary: #fafafa;
    --color-primary-foreground: #0a0a0a;
    --color-secondary: #262626;
    --color-secondary-foreground: #fafafa;
    --color-muted: #262626;
    --color-muted-foreground: #a3a3a3;
    --color-accent: #262626;
    --color-accent-foreground: #fafafa;
    --color-destructive: #ef4444;
    --color-destructive-foreground: #ef4444;
    --color-border: #262626;
    --color-input: #262626;
    --color-ring: #d4d4d4;
    --color-page: #0a0a0a;
  }
}
```

### 5. 빌드 검증
```
npm run build
```
기대: Tailwind가 CSS를 컴파일하고 빌드 성공.

## Acceptance Criteria
- `npm run typecheck` → 0 errors
- `npm run lint` → 0 errors
- `npm run build` → 성공
- `npm test` → `cn` 3 passed, 기존 테스트 회귀 없음(전체 통과)

## Cautions
- **globals.css의 옛 변수(`--bg/--fg/--muted/--border`)를 fallback으로 남기지 말 것.** Reason: 새 시맨틱 토큰으로 완전 교체하는 게 목적이다. 옛 변수를 참조하던 기존 화면은 색이 일시적으로 깨지지만, task-05~07 마이그레이션에서 모두 제거되므로 정상적인 중간 상태다.
- **`next.config.ts`를 건드리지 말 것.** Reason: Tailwind v4는 postcss 단계에서 처리되며 Turbopack과 호환된다(day-sync가 Next 16 Turbopack + Tailwind v4로 동작 중).
- **`tailwind.config.js`를 만들지 말 것.** Reason: v4는 CSS-first 설정이다. 토큰은 `globals.css @theme`에만 둔다.
