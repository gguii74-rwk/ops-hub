# Task 01 — 공용 프리미티브 + PageHeader eyebrow

신설: `Chip`(컬러톤 칩) · `Switch`(토글) · `StatStrip`/`Stat`(요약 통계) · `Toolbar`/`Pill`(필터 툴바). 기존 `PageHeader`에 `eyebrow` 추가. 모두 표현 전용 프리미티브로, 도메인 화면(04~07)이 소비한다.

## Files

- Create `src/components/ui/chip.tsx`
- Create `src/components/ui/switch.tsx`
- Create `src/components/ui/stat-strip.tsx`
- Create `src/components/ui/toolbar.tsx`
- Modify `src/components/ui/page-section.tsx` (PageHeader에 eyebrow)
- Create `tests/components/ui/chip.test.tsx`
- Create `tests/components/ui/switch.test.tsx`
- Create `tests/components/ui/page-header.test.tsx`

## Prep

- entrypoint §Shared Contracts의 프리미티브 시그니처·PageHeader 확장.
- 기존 패턴 확인: `src/components/ui/badge.tsx`(cva·cn), `src/components/ui/page-section.tsx`(현재 PageHeader/PageSection), `src/components/ui/modal.tsx`(client 컴포넌트·jsdom 테스트), `tests/components/ui/modal.test.tsx`(jsdom pragma 예).
- `cn`은 `@/lib/utils`.

## Deps

없음.

## Cautions

- **`Switch`/`Pill`은 client 상호작용이지만 `"use client"`가 꼭 필요한 건 아니다** — 부모(화면 컴포넌트)가 이미 client다. 그래도 단독 import 안전을 위해 `Switch`에는 `"use client"`를 붙인다(이벤트 핸들러 보유). `Chip`/`StatStrip`/`Toolbar`/`Pill`은 순수 프리젠테이션이라 지시어 불필요(단, Pill·Stat은 onClick prop만 전달 — 핸들러 정의는 부모). **Don't** `Chip`에 `"use client"`를 붙이지 말 것. Reason: 서버/클라 양쪽에서 재사용 가능해야 하고 불필요한 client 경계는 번들만 키운다.
- **Chip 톤 클래스는 Tailwind 기본 팔레트 리터럴 문자열로 둔다**(동적 조합 금지). Reason: Tailwind JIT가 정적 클래스만 스캔 → `bg-${x}` 같은 보간은 퍼지(purge)되어 색이 사라진다.

## TDD steps

### 1. Chip — 실패 테스트

`tests/components/ui/chip.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Chip } from "@/components/ui/chip";

afterEach(cleanup);

describe("Chip", () => {
  it("renders children", () => {
    render(<Chip tone="ok">활성</Chip>);
    expect(screen.getByText("활성")).toBeTruthy();
  });
  it("applies tone class (ok → emerald)", () => {
    render(<Chip tone="ok">활성</Chip>);
    expect(screen.getByText("활성").className).toContain("emerald");
  });
  it("defaults to neutral tone when omitted", () => {
    render(<Chip>x</Chip>);
    expect(screen.getByText("x").className).toContain("muted");
  });
  it("merges extra className", () => {
    render(<Chip tone="blue" className="ml-2">b</Chip>);
    expect(screen.getByText("b").className).toContain("ml-2");
  });
});
```

실행: `npm test -- chip` → FAIL(모듈 없음).

### 2. Chip — 구현

`src/components/ui/chip.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export type ChipTone =
  | "ok" | "off" | "blue" | "amber" | "purple" | "orange" | "pink" | "rose" | "neutral";

// 채움형 컬러칩. Tailwind 기본 팔레트(50/700) + 다크 변형. 정적 리터럴(JIT 스캔 안전).
const TONE: Record<ChipTone, string> = {
  ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  off: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  purple: "bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
  orange: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  pink: "bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  neutral: "bg-muted text-muted-foreground",
};

export function Chip({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: ChipTone }) {
  return (
    <span
      data-slot="chip"
      className={cn(
        "inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}
```

실행: `npm test -- chip` → PASS.

### 3. Switch — 실패 테스트

`tests/components/ui/switch.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Switch } from "@/components/ui/switch";

afterEach(cleanup);

describe("Switch", () => {
  it("exposes role=switch with aria-checked reflecting checked", () => {
    render(<Switch checked onCheckedChange={() => {}} label="활성" />);
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.getAttribute("aria-label")).toBe("활성");
  });
  it("calls onCheckedChange with negated value on click", () => {
    const fn = vi.fn();
    render(<Switch checked={false} onCheckedChange={fn} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(fn).toHaveBeenCalledWith(true);
  });
  it("does not fire when disabled", () => {
    const fn = vi.fn();
    render(<Switch checked onCheckedChange={fn} disabled />);
    fireEvent.click(screen.getByRole("switch"));
    expect(fn).not.toHaveBeenCalled();
  });
});
```

실행: `npm test -- switch` → FAIL.

### 4. Switch — 구현

`src/components/ui/switch.tsx`:

```tsx
"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-emerald-600 dark:bg-emerald-500" : "bg-slate-300 dark:bg-slate-600",
        className,
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-3.5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[15px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
```

실행: `npm test -- switch` → PASS.

### 5. StatStrip / Toolbar — 구현 (렌더 전용, 단위테스트 생략 — typecheck로 계약 보장)

`src/components/ui/stat-strip.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function StatStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap gap-2", className)}>{children}</div>;
}

export function Stat({
  value,
  label,
  accent,
  onClick,
  className,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  accent?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const cls = cn(
    "min-w-[88px] rounded-xl border px-3.5 py-2 text-left",
    accent ? "border-ring/30 bg-secondary" : "border-border bg-card",
    onClick && "transition-colors hover:border-ring/50",
    className,
  );
  const body = (
    <>
      <div className={cn("text-lg font-bold tabular-nums", accent && "text-accent-foreground")}>{value}</div>
      <div className="text-[11.5px] text-muted-foreground">{label}</div>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
```

`src/components/ui/toolbar.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

export function Pill({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:border-ring/40",
        className,
      )}
    >
      {children}
    </button>
  );
}
```

(StatStrip/Toolbar는 후속 typecheck/build에서 소비처와 함께 검증.)

### 6. PageHeader eyebrow — 실패 테스트

`tests/components/ui/page-header.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PageHeader } from "@/components/ui/page-section";

afterEach(cleanup);

describe("PageHeader eyebrow", () => {
  it("renders eyebrow above title when provided", () => {
    render(<PageHeader eyebrow="구성원" title="사용자 관리" />);
    expect(screen.getByText("구성원")).toBeTruthy();
    expect(screen.getByText("사용자 관리")).toBeTruthy();
  });
  it("omits eyebrow node when not provided", () => {
    const { container } = render(<PageHeader title="제목" />);
    expect(container.querySelector("[data-slot=eyebrow]")).toBeNull();
  });
});
```

실행: `npm test -- page-header` → FAIL(eyebrow 미지원).

### 7. PageHeader eyebrow — 구현

`src/components/ui/page-section.tsx`의 `PageHeader`만 수정(시그니처에 `eyebrow` 추가, `PageSection`은 그대로 — `PageSection`은 eyebrow를 전달하지 않아도 무방).

기존:

```tsx
function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
```

수정 후:

```tsx
function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1">
        {eyebrow ? (
          <p data-slot="eyebrow" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
```

실행: `npm test -- page-header` → PASS.

### 8. 커밋

```
git add src/components/ui/chip.tsx src/components/ui/switch.tsx src/components/ui/stat-strip.tsx src/components/ui/toolbar.tsx src/components/ui/page-section.tsx tests/components/ui/chip.test.tsx tests/components/ui/switch.test.tsx tests/components/ui/page-header.test.tsx
git commit -m "feat(ui): Chip·Switch·StatStrip·Toolbar 프리미티브 + PageHeader eyebrow"
```

## Acceptance Criteria

```bash
npm run typecheck   # 0 errors
npm run lint        # 0 errors (src — Chip은 use client 없음, Switch만 있음)
npm test            # 신규 chip/switch/page-header 테스트 통과 + 기존 스위트 green
```

기대: `Chip`/`Switch`/`StatStrip`/`Toolbar`/`Pill` export 가능, `PageHeader`가 `eyebrow` 선택 수용(기존 호출부 무파손).
