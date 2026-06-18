# Task 02 — 경계(ui element) + 프리미티브 4종

`ui` element 경계 규칙을 추가하고 `button`·`input`·`textarea`·`label` 프리미티브를 만든다.

## Files
- Create: `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/textarea.tsx`, `src/components/ui/label.tsx`
- Modify: `eslint.config.mjs`

## Prep
- 스펙 §4(경계), §6(프리미티브)
- 엔트리포인트 §Shared Contracts: 경계 룰, 프리미티브 export 시그니처, cn
- 참조(적응 대상): `D:/workspace/day-sync/src/components/ui/{button,input,textarea,label}.tsx` — day-sync는 button/input이 `@base-ui/react`를 쓰므로 native로 적응한다.

## Deps
- task-01 (cn, 토큰)

## Steps

### 1. 경계 규칙 추가 — `eslint.config.mjs`
`boundaries/elements` 배열에 `ui`를 추가한다(기존 `edge` 항목 다음).
```js
{ type: "ui", pattern: "src/components", mode: "folder" },
```
`boundaries/element-types`의 rules 배열에서 `app` 규칙에 `"ui"`를 추가하고, `ui` 규칙을 신규로 넣는다.
```js
{ from: ["app"], allow: ["app", "kernel", "lib", "module", "ui"] },
{ from: ["ui"], allow: ["ui", "lib"] },
```
`module` 규칙은 변경하지 않는다(`module → ui` 보류).

### 2. button.tsx — native `<button>` + cva
day-sync의 cva를 가져오되 Base UI 전용 셀렉터(`aria-expanded:*`, `in-data-[slot=button-group]`, `has-data-[icon=...]`)는 제거하고 size는 default/sm/lg/icon만 둔다.
```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-2.5",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem]",
        lg: "h-9 px-3",
        icon: "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
```

### 3. input.tsx — native `<input>` + cn
```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  );
}

export { Input };
```

### 4. textarea.tsx — native `<textarea>` + cn
```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
```

### 5. label.tsx — native `<label>` + cn
```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Label };
```

### 6. 검증 + 커밋
```
npm run lint
npm run typecheck
npm run build
git add src/components/ui eslint.config.mjs
git commit -m "Add ui boundary and core primitives (button, input, textarea, label)"
```

## Acceptance Criteria
- `npm run lint` → 0 errors. 특히 `boundaries/no-unknown`이 `src/components/ui/*`를 `ui` element로 분류하고, `ui → lib`(cn) import가 허용되어야 한다.
- `npm run typecheck` → 0 errors
- `npm run build` → 성공
- `npm test` → 기존 테스트 회귀 없음

## Cautions
- **`@base-ui/react`를 import하지 말 것.** Reason: 이번 4종은 native element로 충분하며 deps에 Base UI가 없다. day-sync 원본의 `InputPrimitive`/`ButtonPrimitive`를 그대로 가져오면 모듈 해석 실패한다.
- **Button에 `"use client"`를 붙이지 말 것.** Reason: native `<button>`은 서버 컴포넌트로 렌더 가능하다. onClick 등은 이 컴포넌트를 쓰는 client 컴포넌트 쪽에서 전달된다.
- **`module` 경계 규칙을 수정하지 말 것.** Reason: `module → ui`는 의도적으로 보류했다(스펙 §4).
