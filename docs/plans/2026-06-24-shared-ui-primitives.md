# 공용 UI 프리미티브 고정 (system layer)

**Feature:** 화면이 늘기 전에 ad-hoc 마크업을 공용 프리미티브로 승격·통합한다.
**Goal:** 6+ 화면에 복붙된 `<select>`/`<table>`/Modal/타이틀/로딩·에러 마크업을, 기존 디자인 언어를 그대로 따르는 단일 공용 컴포넌트로 대체한다(미관 개편 아님, 일관성 고정).
**Architecture:** `src/components/ui/`에 프리미티브 5종을 신설(Select·Table·Modal·States·PageSection)하고, 소비 화면을 파일 단위로 이관한다. 토큰·셸·폰트는 손대지 않는다.
**Tech Stack:** Next.js App Router, React 19, Tailwind v4(`@theme` 토큰), shadcn식 `cn()`+`data-slot` 컴포넌트, vitest(node env).

---

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-24-shared-ui-primitives/task-NN-<slug>.md`). Task bodies (Files, steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts

### SC-0. 결정 (이 plan의 전제 — 후속 검토가 모를 수 있는 기결정)

| # | 결정 | 근거 |
|---|---|---|
| D1 | **Select 정규 chrome = Input 프리미티브에 정렬** (`h-8 rounded-lg border-input` + focus ring) | 폼에서 select·input 높이 일치(현 잠재 불일치 해소). 폼 select 8곳이 h-9→h-8로 미세 변경됨 — 의도된 정렬 |
| D2 | **Table 이관 범위 = users-list·admin-history·status-client·override-panel** | 사용자 명시 3 + override-panel(정규 패턴 100% 동일). `matrix-editor`(sticky 그리드)·`teams-editor`(인라인 편집)는 **제외** |
| D3 | **Modal 승격 = 이동 + a11y** (Escape·`aria-labelledby`·body scroll-lock + **focus 관리**: 열 때 컨테이너 focus·Tab/Shift+Tab 트랩·닫을 때 직전 focus 복원). **폼 필드 initial-focus는 제외**(폼 포커스 충돌 회피 — D3 원래 우려) | 공용 프리미티브 품질 바닥. aria-modal인데 focus 미관리 문제 반영 — 컨테이너 focus + 트랩 + 복원으로 닫되 폼 auto-focus는 하지 않아 회귀 위험 회피 |
| D4 | **테스트 방식 = 회귀 게이트 + 육안** (아래 SC-4), **단 Modal은 jsdom 동작 테스트 1개**(예외) | 프리젠테이션 프리미티브는 정적 게이트 + 육안으로 충분. 단 Modal은 R1에서 focus/키보드/scroll-lock 런타임 로직이 생겨 정적 검증 불가 → `@testing-library/react` + 파일별 jsdom env로 **Modal 동작만** 테스트. 전역 jsdom 전환은 아님 |
| D5 | 토큰·팔레트·타이포 스케일·셸 레이아웃 **불변**. PageSection은 기존 지배형 타이틀(`font-display text-2xl font-semibold tracking-tight`)을 정규로 삼아 드리프트(admin·settings·dashboard의 `text-xl`)를 통일 | 미관 개편은 범위 밖 |

### SC-1. 신설 프리미티브 API (정규형 — 코드에서 추출)

모든 파일은 `"use client"` 불요(프리젠테이션). Modal만 `"use client"`(effect 사용). `cn`은 `@/lib/utils`(twMerge 기반 — width 등 후행 className override 안전).

**`src/components/ui/select.tsx`** — 네이티브 `<select>` 유지 + Input과 동일 chrome. 기본 `w-full`(필터바는 `className="w-auto"`로 override).
```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80",
        className,
      )}
      {...props}
    />
  );
}
export { Select };
```

**`src/components/ui/table.tsx`** — 최소 compound. 행 border는 `TableBody`의 자식 선택자로 부여(헤더 행 제외 → 기존 visual과 동일). `bordered`(기본 true): Card 내부 임베드 시 `bordered={false}`로 이중 테두리 방지.
```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

function Table({ className, bordered = true, ...props }: React.ComponentProps<"table"> & { bordered?: boolean }) {
  return (
    <div className={cn("overflow-x-auto", bordered && "rounded-lg border border-border")}>
      <table data-slot="table" className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-muted/50 text-left text-muted-foreground", className)} {...props} />;
}
function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr]:border-t [&_tr]:border-border", className)} {...props} />;
}
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn(className)} {...props} />;
}
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("p-2", className)} {...props} />;
}
function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("p-2", className)} {...props} />;
}
function TableEmpty({ colSpan, className, children }: { colSpan: number; className?: string; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className={cn("p-4 text-center text-muted-foreground", className)}>{children}</td>
    </tr>
  );
}
export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty };
```

**`src/components/ui/modal.tsx`** — leave 모달 승격 + Escape·aria·scroll-lock + **focus 관리**(D3: 열 때 컨테이너 focus·Tab 트랩·닫을 때 복원, 폼 필드 initial-focus는 제외). **dialog 시맨틱(`role="dialog"`·`aria-modal`·`aria-labelledby`)은 focus 대상인 Card에 둔다**(focus 요소 = 명명된 dialog 일치; overlay는 backdrop만). `Card`는 `React.ComponentProps<"div">`를 `...props`로 div에 스프레드 → React 19에서 `ref`/`role`/`aria-*`/`tabIndex`가 그대로 div에 전달된다(repo react 19.2.4).
```tsx
"use client";
import { useEffect, useId, useRef } from "react";
import { Card } from "@/components/ui/card";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    card?.focus(); // 열 때 다이얼로그 컨테이너에 focus(폼 필드 auto-focus 안 함 — D3 우려 회피)
    const FOCUSABLE =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !card) return;
      const nodes = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) {
        e.preventDefault();
        card.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === card)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevActive?.focus?.(); // 닫을 때 직전 focus 복원
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <Card
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto p-6 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="font-medium">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
        {children}
      </Card>
    </div>
  );
}
```

**`src/components/ui/states.tsx`** — 로딩·에러·빈상태 3종. **기존 단일 `<p>` 마크업과 visual 동일**(인라인 muted/destructive 문장). **서버 안전 유지**: 이 모듈은 `"use client"` 없이 서버 컴포넌트(예: 페이지의 권한 EmptyState)에서도 렌더되므로 **함수형 이벤트 핸들러 prop을 두지 않는다**(예: `onClick`/`onRetry` 금지 — 서버→클라이언트 직렬화 위반). 재시도 등 상호작용이 필요하면 소비처(client 컴포넌트)에서 처리한다. `EmptyState.action`은 ReactNode라 직렬화 안전.
```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

function LoadingState({ label = "불러오는 중…", className }: { label?: string; className?: string }) {
  return <p className={cn("text-sm text-muted-foreground", className)}>{label}</p>;
}

function ErrorState({
  message = "불러오지 못했습니다.",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return <p className={cn("text-sm text-destructive", className)}>{message}</p>;
}

function EmptyState({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-sm text-muted-foreground", className)}>
      <p>{children}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
export { LoadingState, ErrorState, EmptyState };
```

**`src/components/ui/page-section.tsx`** — 타이틀 정규화 + width 통일.
```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const WIDTH: Record<"full" | "form" | "wide", string> = {
  full: "",
  form: "mx-auto w-full max-w-lg",
  wide: "mx-auto w-full max-w-2xl",
};

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

function PageSection({
  title,
  subtitle,
  actions,
  width = "full",
  className,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  width?: "full" | "form" | "wide";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("space-y-4", WIDTH[width], className)}>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      {children}
    </section>
  );
}
export { PageHeader, PageSection };
```

### SC-2. import 경로
- 프리미티브: `@/components/ui/select`, `@/components/ui/table`, `@/components/ui/modal`, `@/components/ui/states`, `@/components/ui/page-section`.
- **Modal 이관 후** `src/app/(app)/leave/_components/modal.tsx`는 task-10에서 **삭제**(그 전까지 신·구 공존 허용).

### SC-3. 제외 (건드리지 말 것)
- `matrix-editor.tsx`·`teams-editor.tsx` — **Table·Select 모두 이관 제외**(D2). matrix-editor는 셀당 bare `<select>`(className 없음 — 공용 Select의 w-full/h-8가 그리드를 깸) 2개와 sticky 그리드 `<table>`, teams-editor는 인라인 편집 행의 `<select className="border rounded px-2 py-1">` 1개와 편집 `<table>`을 **그대로 둔다**. 따라서 이관 후 `grep "<select" src`가 3건(matrix 2·teams 1) 남는 것은 회귀가 아님.
- 토큰/`globals.css`/`(app)/layout.tsx`/`app-nav.tsx`/폰트 — 불변(D5).
- react-hook-form, FilterBar/ListItem 추출, 타이포 스케일·간격 커스텀 — 범위 밖.

### SC-4. 검증 방식 (D4)
프리젠테이션 프리미티브 + repo 테스트 환경은 기본 **node 전용**(`vitest.config.ts` `environment: "node"`, include `tests/**/*.test.ts`·`src/**/*.test.ts`). 컴포넌트 렌더 테스트는 기본적으로 **추가하지 않는다** — **단 Modal만 예외**: focus/키보드/scroll-lock 런타임 로직이 있어 task-03에서 `@testing-library/react` + 파일별 `// @vitest-environment jsdom`로 **동작 테스트 1개**를 둔다(D4 예외). 이때 include에 `tests/**/*.test.tsx`를 추가하되 전역 environment는 node 유지. 각 task 검증 게이트:
```
npm run typecheck   # prop/import 불일치·타입 회귀 차단
npm run lint        # eslint (boundaries 포함)
npm test            # 기존 스위트(현 1282개) green 유지 = 회귀 없음
npm run build       # 프로덕션 빌드 통과
```
+ 이관 task는 **육안 parity 체크포인트**(해당 화면을 `npm run dev` 또는 kgs-dev에서 확인) 명시. 새 프리미티브 task 중 01·02·04·05는 신규 파일만 추가하므로 typecheck/lint/build로 충분, **03(Modal)은 jsdom 동작 테스트 + `npm test` 포함**.

### SC-5. git 위생 (CLAUDE.md)
두 노트북·보조 세션 공유 가능 → 커밋 전 `.git/index.lock` 확인, `git add -A` 금지(**변경 파일 명시 stage**). AI 서명 금지.

---

## Tasks

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | Select 프리미티브 신설 | [ ] | [task-01](2026-06-24-shared-ui-primitives/task-01-select-primitive.md) | — | |
| 02 | Table 프리미티브 신설 | [ ] | [task-02](2026-06-24-shared-ui-primitives/task-02-table-primitive.md) | — | |
| 03 | Modal 승격(+a11y) | [ ] | [task-03](2026-06-24-shared-ui-primitives/task-03-modal-primitive.md) | — | |
| 04 | States 3종 신설 | [ ] | [task-04](2026-06-24-shared-ui-primitives/task-04-states-primitive.md) | — | |
| 05 | PageHeader/PageSection 신설 | [ ] | [task-05](2026-06-24-shared-ui-primitives/task-05-page-section.md) | — | |
| 06 | admin/users 영역 이관 | [ ] | [task-06](2026-06-24-shared-ui-primitives/task-06-migrate-admin-users.md) | 01,02,03,04 | |
| 07 | leave 영역 이관 | [ ] | [task-07](2026-06-24-shared-ui-primitives/task-07-migrate-leave.md) | 01,02,03,04 | |
| 08 | 기타 Select 사이트 이관 | [ ] | [task-08](2026-06-24-shared-ui-primitives/task-08-migrate-select-misc.md) | 01 | |
| 09 | 페이지 헤더 이관 | [ ] | [task-09](2026-06-24-shared-ui-primitives/task-09-migrate-page-headers.md) | 04,05 | |
| 10 | 구 Modal 삭제 + 최종 검증 | [ ] | [task-10](2026-06-24-shared-ui-primitives/task-10-cleanup-verify.md) | 03,06,07 | |

**병렬성:** 01–05는 서로 무관(신규 파일) → 동시 실행 가능. 06·07·08·09는 각자 다른 파일만 수정 → 의존 충족 후 동시 실행 가능. 10은 마지막(구 modal.tsx 삭제 + 전체 게이트).
