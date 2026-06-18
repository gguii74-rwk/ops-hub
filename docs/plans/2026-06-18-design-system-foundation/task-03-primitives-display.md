# Task 03 — 프리미티브 3종 (card / badge / separator)

`card`(복합)·`badge`·`separator` 프리미티브를 만든다.

## Files
- Create: `src/components/ui/card.tsx`, `src/components/ui/badge.tsx`, `src/components/ui/separator.tsx`

## Prep
- 스펙 §6
- 엔트리포인트 §Shared Contracts: 프리미티브 export 시그니처, cn
- 참조(적응 대상): `D:/workspace/day-sync/src/components/ui/{card,badge,separator}.tsx` — `card`는 이미 native div, `badge`는 `useRender`/`mergeProps`(Base UI), `separator`는 `@base-ui/react/separator`를 쓰므로 badge/separator를 native로 적응한다.

## Deps
- task-01 (cn, 토큰)
- task-02 (ui 경계가 이미 적용됨)

## Steps

### 1. card.tsx — 복합 컴포넌트 (native div, day-sync 그대로)
```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10 has-data-[slot=card-footer]:pb-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0",
        className
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-4 group-data-[size=sm]/card:px-3", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/card:p-3",
        className
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
```

### 2. badge.tsx — native `<span>` + cva (Base UI useRender 제거)
```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive/10 text-destructive dark:bg-destructive/20",
        outline: "border-border text-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
```

### 3. separator.tsx — native `<div role="separator">` + cn
```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      data-slot="separator"
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "w-px self-stretch",
        className
      )}
      {...props}
    />
  );
}

export { Separator };
```

### 4. 검증 + 커밋
```
npm run lint
npm run typecheck
npm run build
git add src/components/ui/card.tsx src/components/ui/badge.tsx src/components/ui/separator.tsx
git commit -m "Add display primitives (card, badge, separator)"
```

## Acceptance Criteria
- `npm run lint` → 0 errors (ui 경계 통과)
- `npm run typecheck` → 0 errors
- `npm run build` → 성공
- `npm test` → 기존 테스트 회귀 없음

## Cautions
- **badge/separator에 `@base-ui/react`(`useRender`/`mergeProps`/`SeparatorPrimitive`)를 쓰지 말 것.** Reason: deps에 없다. native span/div로 적응한다.
- **badge는 `rounded-full`을 쓴다.** Reason: day-sync 원본의 `rounded-4xl`은 우리가 정의하지 않은 radius 토큰에 의존할 수 있다. `rounded-full`은 토큰과 무관하게 알약형을 보장한다.
