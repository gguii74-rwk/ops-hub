# Task 02 — kind→색 / status→오버레이 SSOT

`kind`(색)와 `status`(형태 오버레이)를 직교 분리해 단일 출처로 둔다(D4/D5). 통합 `calendar-view.tsx`의 현 `KIND_CLASS`(soft 전용)를 이리로 이전하고 `bold` variant를 추가한다.

## Files

- **Create** `src/modules/calendar/ui/kind-styles.ts`.
- **Create (test)** `tests/modules/calendar/kind-styles.test.ts`.

## Prep

- 읽기: spec D4(kind→색)·D5(status→오버레이), entrypoint §Shared Contracts(`kind-styles.ts` 시그니처 + Tailwind purge 주의).
- 현재 색 출처(이전 대상): `src/app/(app)/calendar/calendar-view.tsx` line 12–20의 `KIND_CLASS`(7종 soft). 이 리터럴을 `soft`로 그대로 옮긴다.
- §Shared Contracts items 사용: `Intensity`·`EventStatus`(task 01의 `event-input.ts`).

## Deps

- task 01 (`event-input.ts`의 `Intensity`·`EventStatus`).

## Step 1 — 실패 테스트 작성

`tests/modules/calendar/kind-styles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { kindClass, statusOverlay } from "@/modules/calendar/ui/kind-styles";

describe("kindClass", () => {
  it("등록 kind는 intensity별로 다른 클래스(soft≠bold)", () => {
    const soft = kindClass("WORKFLOW_TASK", "soft");
    const bold = kindClass("WORKFLOW_TASK", "bold");
    expect(soft).toContain("orange-100");
    expect(bold).toContain("orange-500");
    expect(soft).not.toBe(bold);
  });

  it("연차 전용 leaveType도 색 매핑(HALF=teal, QUARTER=cyan, ANNUAL=emerald)", () => {
    expect(kindClass("HALF", "soft")).toContain("teal");
    expect(kindClass("QUARTER", "soft")).toContain("cyan");
    expect(kindClass("ANNUAL", "soft")).toContain("emerald");
  });

  it("미등록 kind는 중립 폴백(빈 문자열 아님)", () => {
    const cls = kindClass("UNKNOWN_KIND", "soft");
    expect(cls.length).toBeGreaterThan(0);
    expect(cls).not.toContain("orange");
  });
});

describe("statusOverlay (색과 직교, 형태만)", () => {
  it("PENDING = 점선 테두리", () => {
    expect(statusOverlay("PENDING")).toContain("border-dashed");
  });
  it("REJECTED/CANCELLED = 취소선 + 흐림", () => {
    expect(statusOverlay("REJECTED")).toContain("line-through");
    expect(statusOverlay("CANCELLED")).toContain("line-through");
    expect(statusOverlay("CANCELLED")).toContain("opacity");
  });
  it("APPROVED·null·undefined = 기본(빈 문자열)", () => {
    expect(statusOverlay("APPROVED")).toBe("");
    expect(statusOverlay(null)).toBe("");
    expect(statusOverlay()).toBe("");
  });
});
```

**Run (expect FAIL):**
```bash
npm test -- tests/modules/calendar/kind-styles.test.ts
```

## Step 2 — `kind-styles.ts` 구현

> **Tailwind purge 주의(필수):** 클래스명을 `bg-${hue}-100` 식으로 합성하면 JIT가 못 찾아 색이 사라진다. 아래처럼 **완전 리터럴 문자열**로 둔다. `soft`는 현 `KIND_CLASS`에서 그대로 이전, `bold`는 같은 색 계열의 진한 배경 + 흰 글씨.

`src/modules/calendar/ui/kind-styles.ts`:

```ts
import { cn } from "@/lib/utils";
import type { Intensity, EventStatus } from "./event-input";

interface KindStyle {
  soft: string;
  bold: string;
}

// kind → 색(soft/bold). D4: 네비 팔레트 계승 + 연차 전용 leaveType(ANNUAL/HALF/QUARTER).
// soft는 현 calendar-view KIND_CLASS 이전, bold는 같은 계열 진한 배경.
const KIND_STYLES: Record<string, KindStyle> = {
  INTERNAL_LEAVE: {
    soft: "bg-emerald-100 text-emerald-950 ring-1 ring-emerald-300/70 dark:bg-emerald-500/20 dark:text-emerald-100 dark:ring-emerald-400/30",
    bold: "bg-emerald-500 text-white ring-1 ring-emerald-600/40 dark:bg-emerald-500/80 dark:text-emerald-50 dark:ring-emerald-400/40",
  },
  EXTERNAL_VACATION: {
    soft: "bg-lime-100 text-lime-950 ring-1 ring-lime-300/70 dark:bg-lime-400/20 dark:text-lime-100 dark:ring-lime-300/30",
    bold: "bg-lime-500 text-lime-950 ring-1 ring-lime-600/40 dark:bg-lime-500/80 dark:text-lime-50 dark:ring-lime-400/40",
  },
  WORKFLOW_TASK: {
    soft: "bg-orange-100 text-orange-950 ring-1 ring-orange-300/70 dark:bg-orange-500/20 dark:text-orange-100 dark:ring-orange-300/30",
    bold: "bg-orange-500 text-white ring-1 ring-orange-600/40 dark:bg-orange-500/80 dark:text-orange-50 dark:ring-orange-400/40",
  },
  HOLIDAY: {
    soft: "bg-rose-100 text-rose-950 ring-1 ring-rose-300/70 dark:bg-rose-500/20 dark:text-rose-100 dark:ring-rose-300/30",
    bold: "bg-rose-500 text-white ring-1 ring-rose-600/40 dark:bg-rose-500/80 dark:text-rose-50 dark:ring-rose-400/40",
  },
  EXTERNAL_EVENT: {
    soft: "bg-slate-200 text-slate-800 ring-1 ring-slate-300 dark:bg-slate-700/50 dark:text-slate-100 dark:ring-slate-600",
    bold: "bg-slate-500 text-white ring-1 ring-slate-600/40 dark:bg-slate-600/80 dark:text-slate-50 dark:ring-slate-500/40",
  },
  PERSONAL_EVENT: {
    soft: "bg-indigo-100 text-indigo-950 ring-1 ring-indigo-300/70 dark:bg-indigo-500/20 dark:text-indigo-100 dark:ring-indigo-300/30",
    bold: "bg-indigo-500 text-white ring-1 ring-indigo-600/40 dark:bg-indigo-500/80 dark:text-indigo-50 dark:ring-indigo-400/40",
  },
  TEAM_EVENT: {
    soft: "bg-cyan-100 text-cyan-950 ring-1 ring-cyan-300/70 dark:bg-cyan-500/20 dark:text-cyan-100 dark:ring-cyan-300/30",
    bold: "bg-cyan-500 text-white ring-1 ring-cyan-600/40 dark:bg-cyan-500/80 dark:text-cyan-50 dark:ring-cyan-400/40",
  },
  // 연차 전용(leaveType을 kind로) — soft만 사용(intensity="soft"), bold는 형 통일용.
  ANNUAL: {
    soft: "bg-emerald-100 text-emerald-950 ring-1 ring-emerald-300/70 dark:bg-emerald-500/20 dark:text-emerald-100 dark:ring-emerald-400/30",
    bold: "bg-emerald-500 text-white ring-1 ring-emerald-600/40 dark:bg-emerald-500/80 dark:text-emerald-50",
  },
  HALF: {
    soft: "bg-teal-100 text-teal-950 ring-1 ring-teal-300/70 dark:bg-teal-500/20 dark:text-teal-100 dark:ring-teal-400/30",
    bold: "bg-teal-500 text-white ring-1 ring-teal-600/40 dark:bg-teal-500/80 dark:text-teal-50",
  },
  QUARTER: {
    soft: "bg-cyan-100 text-cyan-950 ring-1 ring-cyan-300/70 dark:bg-cyan-500/20 dark:text-cyan-100 dark:ring-cyan-400/30",
    bold: "bg-cyan-500 text-white ring-1 ring-cyan-600/40 dark:bg-cyan-500/80 dark:text-cyan-50",
  },
};

const NEUTRAL: KindStyle = {
  soft: "bg-accent text-accent-foreground ring-1 ring-border",
  bold: "bg-slate-500 text-white ring-1 ring-slate-600/40 dark:bg-slate-600/80 dark:text-slate-50",
};

export function kindClass(kind: string, intensity: Intensity): string {
  return (KIND_STYLES[kind] ?? NEUTRAL)[intensity];
}

// status → 오버레이(형태). 색과 직교(D5). PENDING=점선, REJECTED/CANCELLED=취소선+흐림.
export function statusOverlay(status?: EventStatus | null): string {
  if (status === "PENDING") return "border border-dashed border-current";
  if (status === "REJECTED" || status === "CANCELLED") return "line-through opacity-60";
  return "";
}

// 호출부가 색+오버레이를 한 번에 합칠 때 사용(편의). 미사용 시 트리 셰이킹.
export function eventChipClass(kind: string, intensity: Intensity, status?: EventStatus | null): string {
  return cn(kindClass(kind, intensity), statusOverlay(status));
}
```

**Run (expect PASS):**
```bash
npm test -- tests/modules/calendar/kind-styles.test.ts
```

## Step 3 — commit

```bash
git add src/modules/calendar/ui/kind-styles.ts tests/modules/calendar/kind-styles.test.ts
git commit -m "feat(calendar): kind→색(soft/bold)·status→오버레이 SSOT 신설"
```

## Acceptance Criteria

```bash
npm test -- tests/modules/calendar/kind-styles.test.ts   # PASS
npm run typecheck                                         # 에러 0
npm run lint                                              # 통과
```

## Cautions

- **클래스명을 문자열 합성으로 만들지 말 것.** 이유: Tailwind JIT purge가 동적 클래스를 못 찾아 프로덕션 빌드에서 색이 사라진다. 반드시 완전 리터럴.
- **status를 색으로 표현하지 말 것.** 이유: D5 — 상태는 형태 오버레이, 종류는 색. 기존 연차의 `PENDING=amber`·`반려=muted`를 색에서 형태로 이전하는 것이 이 task의 목적. `statusOverlay`에 배경색 클래스를 넣지 않는다.
- **`calendar-view.tsx`의 `KIND_CLASS`는 이 task에서 지우지 않는다.** 이유: 소비처 교체는 task 04. 여기서는 신설만. (지우면 task 04 전까지 빌드 깨짐.)
