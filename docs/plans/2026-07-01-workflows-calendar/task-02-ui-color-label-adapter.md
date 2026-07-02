# Task 02 — UI 색·라벨·어댑터 (kind-styles 5색 · KIND_LABEL 5종 · toCalendarEvent)

캘린더 표현 재료를 만든다: kind별 색(kind-styles additive, D7), 5종 사용자 라벨 통일 + 필터 순서(labels.ts), WorkflowTask→CalendarEventInput 순수 어댑터(SC-8).

## Files
- Modify: `src/modules/calendar/ui/kind-styles.ts` (`KIND_STYLES`에 5 kind 키 추가)
- Modify: `src/app/(app)/workflows/labels.ts` (`KIND_LABEL` 5종 통일 + `WORKFLOW_KIND_ORDER`)
- Create: `src/app/(app)/workflows/workflow-calendar-adapter.ts` (`toCalendarEvent`)
- Test: `tests/modules/calendar/kind-styles.test.ts` (신규 — 5 workflow kind 색 비-중립)
- Test: `tests/app/workflows/labels.test.ts` (신규 — KIND_LABEL·WORKFLOW_KIND_ORDER)
- Test: `tests/app/workflows/workflow-calendar-adapter.test.ts` (신규 — 어댑터)

## Prep
- 엔트리포인트 §Shared Contracts SC-5(라벨·순서), SC-6(색), SC-7(이벤트 모델), SC-8(어댑터).
- 참조 구현: `src/app/(app)/leave/_components/leave-adapter.ts`(`holidaysToEvents`가 `allDayHalfOpen(date,date)` 단일일 패턴).
- D7(색), D8(CANCELLED만 오버레이 — PENDING은 kind색 유지).

## Deps
- Task 01(신규 `WorkflowKind` enum·`KIND_RESOURCE`). 어댑터·라벨이 `WorkflowKind` 타입을 참조.

## Cautions
- **Don't PENDING을 EventStatus로 그대로 넘기지 마라.** `statusOverlay("PENDING")`은 amber 점선으로 kind색을 덮는다(연차 대기 UX). 워크플로 PENDING은 정상 상태라 kind색 유지가 맞다(D8) → 어댑터는 `CANCELLED`만 오버레이, 나머지 전부 `null`.
- **Don't `WORKFLOW_TASK` 색을 건드리지 마라.** 통합 캘린더가 쓰는 단일 주황 키다. 신규 per-kind `BILLING`(역시 주황)은 **별도 키**로 추가(충돌 없음).
- **Don't 어댑터에 ui 프리미티브를 import하지 마라.** 순수 변환 함수(module time·calendar 타입·labels만). `@/components/ui/*` 금지(boundaries).
- **Don't end를 생략하지 마라.** `allDayHalfOpen(d,d)`로 명시적 `start`+`end`를 채운다(holidaysToEvents와 동일 검증된 패턴).

## TDD Steps

### 1. kind-styles — 실패 테스트 먼저

`tests/modules/calendar/kind-styles.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import { kindClass } from "@/modules/calendar/ui/kind-styles";

// 신규 workflow kind 5종이 중립 폴백이 아닌 고유 색을 가져야 함(D7).
const WORKFLOW_KINDS = ["BILLING", "NOTIFICATION_BILLING", "WEEKLY_REPORT", "WEEKLY_REPORT_CLIENT", "MONTHLY_REPORT_CLIENT"];
const NEUTRAL_SOFT = "bg-accent text-accent-foreground ring-1 ring-border";

describe("kindClass — workflow kind 색(D7)", () => {
  it("5 workflow kind 모두 soft/bold가 중립 폴백이 아니다", () => {
    for (const k of WORKFLOW_KINDS) {
      expect(kindClass(k, "soft")).not.toBe(NEUTRAL_SOFT);
      expect(kindClass(k, "bold")).not.toBe(NEUTRAL_SOFT);
    }
  });

  it("각 kind 색이 서로 다르다(식별성)", () => {
    const softs = WORKFLOW_KINDS.map((k) => kindClass(k, "soft"));
    expect(new Set(softs).size).toBe(WORKFLOW_KINDS.length);
  });

  it("D7 팔레트 계열 — 대금청구=주황·알림톡청구=청록·주간(본부)=인디고·주간(고객사)=보라·월간(고객사)=핑크", () => {
    expect(kindClass("BILLING", "soft")).toContain("orange");
    expect(kindClass("NOTIFICATION_BILLING", "soft")).toContain("cyan");
    expect(kindClass("WEEKLY_REPORT", "soft")).toContain("indigo");
    expect(kindClass("WEEKLY_REPORT_CLIENT", "soft")).toContain("violet");
    expect(kindClass("MONTHLY_REPORT_CLIENT", "soft")).toContain("pink");
  });
});
```

실행: `npm test -- tests/modules/calendar/kind-styles.test.ts` → **FAIL**(신규 키 없어 중립 폴백).

### 2. kind-styles 구현

`src/modules/calendar/ui/kind-styles.ts`의 `KIND_STYLES` 객체에 5개 키 추가(마지막 `QUARTER` 항목 뒤, 닫는 `}` 앞):

```ts
  // 워크플로 kind별 색(D7) — 통합 캘린더 WORKFLOW_TASK(단일 주황)와 별개 additive.
  BILLING: {
    soft: "bg-orange-100 text-orange-950 ring-1 ring-orange-300/70 dark:bg-orange-500/20 dark:text-orange-100 dark:ring-orange-300/30",
    bold: "bg-orange-500 text-white ring-1 ring-orange-600/40 dark:bg-orange-500/80 dark:text-orange-50 dark:ring-orange-400/40",
  },
  NOTIFICATION_BILLING: {
    soft: "bg-cyan-100 text-cyan-950 ring-1 ring-cyan-300/70 dark:bg-cyan-500/20 dark:text-cyan-100 dark:ring-cyan-400/30",
    bold: "bg-cyan-500 text-white ring-1 ring-cyan-600/40 dark:bg-cyan-500/80 dark:text-cyan-50 dark:ring-cyan-400/40",
  },
  WEEKLY_REPORT: {
    soft: "bg-indigo-100 text-indigo-950 ring-1 ring-indigo-300/70 dark:bg-indigo-500/20 dark:text-indigo-100 dark:ring-indigo-300/30",
    bold: "bg-indigo-500 text-white ring-1 ring-indigo-600/40 dark:bg-indigo-500/80 dark:text-indigo-50 dark:ring-indigo-400/40",
  },
  WEEKLY_REPORT_CLIENT: {
    soft: "bg-violet-100 text-violet-950 ring-1 ring-violet-300/70 dark:bg-violet-500/20 dark:text-violet-100 dark:ring-violet-400/30",
    bold: "bg-violet-500 text-white ring-1 ring-violet-600/40 dark:bg-violet-500/80 dark:text-violet-50 dark:ring-violet-400/40",
  },
  MONTHLY_REPORT_CLIENT: {
    soft: "bg-pink-100 text-pink-950 ring-1 ring-pink-300/70 dark:bg-pink-500/20 dark:text-pink-100 dark:ring-pink-400/30",
    bold: "bg-pink-500 text-white ring-1 ring-pink-600/40 dark:bg-pink-500/80 dark:text-pink-50 dark:ring-pink-400/40",
  },
```

실행: `npm test -- tests/modules/calendar/kind-styles.test.ts` → **PASS**.

### 3. labels — 실패 테스트 먼저

`tests/app/workflows/labels.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import { KIND_LABEL, WORKFLOW_KIND_ORDER } from "@/app/(app)/workflows/labels";

describe("KIND_LABEL — 5종 사용자 명칭 통일(SC-5)", () => {
  it("5 kind 라벨", () => {
    expect(KIND_LABEL.BILLING).toBe("대금청구");
    expect(KIND_LABEL.NOTIFICATION_BILLING).toBe("알림톡청구");
    expect(KIND_LABEL.WEEKLY_REPORT).toBe("주간보고(본부)");
    expect(KIND_LABEL.WEEKLY_REPORT_CLIENT).toBe("주간보고(고객사)");
    expect(KIND_LABEL.MONTHLY_REPORT_CLIENT).toBe("월간보고(고객사)");
  });
});

describe("WORKFLOW_KIND_ORDER — 필터·드롭다운 순서(D6/D10)", () => {
  it("5종·enum 값·고정 순서", () => {
    expect(WORKFLOW_KIND_ORDER).toEqual([
      "BILLING", "NOTIFICATION_BILLING", "WEEKLY_REPORT", "WEEKLY_REPORT_CLIENT", "MONTHLY_REPORT_CLIENT",
    ]);
  });
  it("모든 순서 항목이 KIND_LABEL을 가진다", () => {
    for (const k of WORKFLOW_KIND_ORDER) expect(KIND_LABEL[k]).toBeTruthy();
  });
});
```

실행: `npm test -- tests/app/workflows/labels.test.ts` → **FAIL**.

### 4. labels 구현

`src/app/(app)/workflows/labels.ts` 상단에 `WorkflowKind` import를 추가하고 `KIND_LABEL`(5~9행)을 교체 + `WORKFLOW_KIND_ORDER` 추가:

```ts
import type { WorkflowKind } from "@prisma/client";
```

```ts
export const KIND_LABEL: Record<string, string> = {
  WEEKLY_REPORT: "주간보고(본부)",
  BILLING: "대금청구",
  NOTIFICATION_BILLING: "알림톡청구",
  WEEKLY_REPORT_CLIENT: "주간보고(고객사)",
  MONTHLY_REPORT_CLIENT: "월간보고(고객사)",
};

// 필터(전체+5)·생성 드롭다운 공통 표시 순서(D6/D10). 값=WorkflowKind enum.
export const WORKFLOW_KIND_ORDER: WorkflowKind[] = [
  "BILLING", "NOTIFICATION_BILLING", "WEEKLY_REPORT", "WEEKLY_REPORT_CLIENT", "MONTHLY_REPORT_CLIENT",
];
```

(기존 `WfStatus`·`MailStatus`·`STATUS_LABEL`·`MAIL_LABEL`·`CANCELLABLE` 등은 **불변** — 라벨만 변경.)

실행: `npm test -- tests/app/workflows/labels.test.ts` → **PASS**.

### 5. 어댑터 — 실패 테스트 먼저

`tests/app/workflows/workflow-calendar-adapter.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import { toCalendarEvent, type WorkflowCalendarItem } from "@/app/(app)/workflows/workflow-calendar-adapter";

const base: WorkflowCalendarItem = {
  id: "t1", kind: "BILLING", typeName: "대금청구",
  scheduledAt: "2026-07-10T05:00:00.000Z", status: "PENDING",
};

describe("toCalendarEvent", () => {
  it("kind=WorkflowKind, title=KIND_LABEL, 단일일 half-open [dayStart,+1일)", () => {
    const ev = toCalendarEvent(base);
    expect(ev.id).toBe("t1");
    expect(ev.kind).toBe("BILLING");
    expect(ev.title).toBe("대금청구");
    // KST 2026-07-10 → dayStart = 2026-07-09T15:00:00Z, end = +1일
    expect(ev.start).toBe("2026-07-09T15:00:00.000Z");
    expect(ev.end).toBe("2026-07-10T15:00:00.000Z");
  });

  it("PENDING/GENERATED/SENT 등은 status=null(kind색 유지 — D8)", () => {
    for (const s of ["PENDING", "GENERATED", "REVIEWED", "SENT", "HQ_REQUESTED", "FINAL_SENT"] as const) {
      expect(toCalendarEvent({ ...base, status: s }).status).toBeNull();
    }
  });

  it("CANCELLED만 오버레이 status=CANCELLED(취소선)", () => {
    expect(toCalendarEvent({ ...base, status: "CANCELLED" }).status).toBe("CANCELLED");
  });

  it("신규 client kind도 라벨·색 키가 kind로 전달된다", () => {
    const ev = toCalendarEvent({ ...base, kind: "WEEKLY_REPORT_CLIENT", typeName: "주간보고(고객사)" });
    expect(ev.kind).toBe("WEEKLY_REPORT_CLIENT");
    expect(ev.title).toBe("주간보고(고객사)");
  });
});
```

실행: `npm test -- tests/app/workflows/workflow-calendar-adapter.test.ts` → **FAIL**(파일 없음).

### 6. 어댑터 구현

`src/app/(app)/workflows/workflow-calendar-adapter.ts` 생성:

```ts
import type { WorkflowKind, WorkflowStatus } from "@prisma/client";
import { allDayHalfOpen } from "@/modules/calendar/time";
import type { CalendarEventInput } from "@/modules/calendar/ui/event-input";
import { KIND_LABEL } from "./labels";

// 캘린더 조회 응답(GET /api/workflows/calendar) 1건. (services TaskListItem과 동형)
export interface WorkflowCalendarItem {
  id: string;
  kind: WorkflowKind;
  typeName: string;
  scheduledAt: string;
  status: WorkflowStatus;
}

// WorkflowTask → 공통 캘린더 이벤트(순수함수). 예정일 단일일 이벤트:
// kind=WorkflowKind(색 키, SC-6), title=KIND_LABEL(폴백 typeName), start/end=KST 단일일 half-open(D14).
// status 오버레이(D8): CANCELLED만 취소선, PENDING 등 정상 상태는 null(kind색 유지 — PENDING을 넘기면 amber가 색을 덮음).
export function toCalendarEvent(item: WorkflowCalendarItem): CalendarEventInput {
  const d = new Date(item.scheduledAt);
  const { start, end } = allDayHalfOpen(d, d);
  return {
    id: item.id,
    title: KIND_LABEL[item.kind] ?? item.typeName,
    kind: item.kind,
    start: start.toISOString(),
    end: end.toISOString(),
    status: item.status === "CANCELLED" ? "CANCELLED" : null,
  };
}
```

실행: `npm test -- tests/app/workflows/workflow-calendar-adapter.test.ts` → **PASS**.

### 7. 커밋

```bash
npm run typecheck && npm run lint && npm test -- tests/modules/calendar/kind-styles.test.ts tests/app/workflows/labels.test.ts tests/app/workflows/workflow-calendar-adapter.test.ts
```
기대: 전부 green. 이후 커밋.

## Acceptance Criteria
- `npm run typecheck` → 통과.
- `npm run lint` → 통과(어댑터가 ui import 없음 확인 — boundaries).
- `npm test -- tests/modules/calendar/kind-styles.test.ts tests/app/workflows/labels.test.ts tests/app/workflows/workflow-calendar-adapter.test.ts` → 통과.
- `kindClass("BILLING","soft")`이 중립 폴백이 아니고 5종 색이 서로 다름.
- `toCalendarEvent`가 `CANCELLED`만 오버레이, `start`/`end` 명시(단일일 half-open).
