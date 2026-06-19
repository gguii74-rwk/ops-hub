# Task 05 — 내부 provider (leave·workflow·manual)

권위 테이블/수동 이벤트를 `RawEvent`로 매핑하는 provider 3종. 각 provider는 실패를 격리해(try/catch) `state:"failed"` status로 환원한다(다른 출처에 영향 없음).

## Files

- Create: `src/modules/calendar/sources/internalLeave.ts`
- Create: `src/modules/calendar/sources/workflowTask.ts`
- Create: `src/modules/calendar/sources/manual.ts`
- Test: `tests/modules/calendar/sources/internal.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts: `CalendarSourceProvider`, `RawEvent`, `SourceResult`, time 유틸(`allDayHalfOpen`).
- repository 시그니처(Task 02): `findLeaveInRange`, `findWorkflowTasksInRange`, `findManualEventsInRange`.

## Deps

01 (types/time), 02 (repository).

## Steps

### 1. 테스트 먼저 (FAIL 확인)

`tests/modules/calendar/sources/internal.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ leave: vi.fn(), wf: vi.fn(), manual: vi.fn() }));
vi.mock("@/modules/calendar/repositories", () => ({
  findLeaveInRange: h.leave,
  findWorkflowTasksInRange: h.wf,
  findManualEventsInRange: h.manual,
}));

import { internalLeaveProvider } from "@/modules/calendar/sources/internalLeave";
import { workflowTaskProvider } from "@/modules/calendar/sources/workflowTask";
import { manualProvider } from "@/modules/calendar/sources/manual";

const range = { start: new Date("2026-05-30T15:00:00Z"), end: new Date("2026-07-11T15:00:00Z") };
const ctx = { userId: "u1", isOwner: false, permissionKeys: new Set<string>() };

beforeEach(() => {
  h.leave.mockReset();
  h.wf.mockReset();
  h.manual.mockReset();
});

describe("internalLeaveProvider", () => {
  it("LeaveRow → INTERNAL_LEAVE RawEvent (all-day, KST 반열림, reason→description)", async () => {
    h.leave.mockResolvedValue([
      { id: "l1", userId: "u9", leaveType: "ANNUAL", reason: "가족 여행", startDate: new Date("2026-06-10"), endDate: new Date("2026-06-11"), status: "APPROVED" },
    ]);
    const out = await internalLeaveProvider.fetchEvents(range, ctx);
    expect(out.statuses).toEqual([{ key: "internalLeave", state: "ok", lastFetchedAt: null, error: null }]);
    expect(out.events).toEqual([
      {
        id: "leave:l1",
        kind: "INTERNAL_LEAVE",
        title: "휴가",
        description: "가족 여행",
        start: new Date("2026-06-09T15:00:00Z"),
        end: new Date("2026-06-11T15:00:00Z"),
        allDay: true,
        userId: "u9",
        sourceKey: "internalLeave",
        externalId: null,
        dedupStatus: "UNIQUE",
        duplicateOfId: null,
      },
    ]);
    expect(h.leave).toHaveBeenCalledWith(range, ["APPROVED", "PENDING"]);
  });

  it("repository throw → events 빈 배열 + failed status", async () => {
    h.leave.mockRejectedValue(new Error("db down"));
    const out = await internalLeaveProvider.fetchEvents(range, ctx);
    expect(out.events).toEqual([]);
    expect(out.statuses[0]).toEqual({ key: "internalLeave", state: "failed", lastFetchedAt: null, error: "db down" });
  });
});

describe("workflowTaskProvider", () => {
  it("WorkflowRow → WORKFLOW_TASK RawEvent (해당 KST 일 all-day)", async () => {
    h.wf.mockResolvedValue([{ id: "w1", title: "주간보고", scheduledAt: new Date("2026-06-12T01:00:00Z"), status: "PENDING" }]);
    const out = await workflowTaskProvider.fetchEvents(range, ctx);
    expect(out.events[0]).toMatchObject({ id: "workflow:w1", kind: "WORKFLOW_TASK", title: "주간보고", allDay: true, sourceKey: "workflowTask", userId: null });
    // 2026-06-12T01:00Z = 06-12 10:00 KST → 06-12 00:00 KST = 2026-06-11T15:00Z
    expect(out.events[0].start.toISOString()).toBe("2026-06-11T15:00:00.000Z");
    expect(out.events[0].end.toISOString()).toBe("2026-06-12T15:00:00.000Z");
  });
});

describe("manualProvider", () => {
  it("ManualRow → RawEvent (kind·userId·sourceKey 보존)", async () => {
    h.manual.mockResolvedValue([
      { id: "m1", kind: "TEAM_EVENT", title: "팀 워크숍", description: "오프사이트", startsAt: new Date("2026-06-12T00:00:00Z"), endsAt: new Date("2026-06-13T00:00:00Z"), allDay: true, userId: null, sourceKey: "manual-team" },
    ]);
    const out = await manualProvider.fetchEvents(range, ctx);
    expect(out.events[0]).toEqual({
      id: "manual:m1",
      kind: "TEAM_EVENT",
      title: "팀 워크숍",
      description: "오프사이트",
      start: new Date("2026-06-12T00:00:00Z"),
      end: new Date("2026-06-13T00:00:00Z"),
      allDay: true,
      userId: null,
      sourceKey: "manual-team",
      externalId: null,
      dedupStatus: "UNIQUE",
      duplicateOfId: null,
    });
    expect(out.statuses[0].state).toBe("ok");
  });
});
```

실행(FAIL): `npm test -- tests/modules/calendar/sources/internal.test.ts`

### 2. 구현 (PASS 확인)

`src/modules/calendar/sources/internalLeave.ts`:

```ts
import type { CalendarSourceProvider, FeedContext, NormalizedRange, RawEvent, SourceResult } from "../types";
import { findLeaveInRange, type LeaveRow } from "../repositories";
import { allDayHalfOpen } from "../time";

const KEY = "internalLeave";

function toRawEvent(l: LeaveRow): RawEvent {
  const { start, end } = allDayHalfOpen(l.startDate, l.endDate);
  return {
    id: `leave:${l.id}`,
    kind: "INTERNAL_LEAVE",
    title: "휴가",
    description: l.reason,
    start,
    end,
    allDay: true,
    userId: l.userId,
    sourceKey: KEY,
    externalId: null,
    dedupStatus: "UNIQUE",
    duplicateOfId: null,
  };
}

export const internalLeaveProvider: CalendarSourceProvider = {
  key: KEY,
  async fetchEvents(range: NormalizedRange, _ctx: FeedContext): Promise<SourceResult> {
    try {
      const rows = await findLeaveInRange(range, ["APPROVED", "PENDING"]);
      return { events: rows.map(toRawEvent), statuses: [{ key: KEY, state: "ok", lastFetchedAt: null, error: null }] };
    } catch (e) {
      return { events: [], statuses: [{ key: KEY, state: "failed", lastFetchedAt: null, error: e instanceof Error ? e.message : String(e) }] };
    }
  },
};
```

`src/modules/calendar/sources/workflowTask.ts`:

```ts
import type { CalendarSourceProvider, FeedContext, NormalizedRange, RawEvent, SourceResult } from "../types";
import { findWorkflowTasksInRange, type WorkflowRow } from "../repositories";
import { allDayHalfOpen } from "../time";

const KEY = "workflowTask";

function toRawEvent(w: WorkflowRow): RawEvent {
  const { start, end } = allDayHalfOpen(w.scheduledAt, w.scheduledAt);
  return {
    id: `workflow:${w.id}`,
    kind: "WORKFLOW_TASK",
    title: w.title,
    description: null,
    start,
    end,
    allDay: true,
    userId: null,
    sourceKey: KEY,
    externalId: null,
    dedupStatus: "UNIQUE",
    duplicateOfId: null,
  };
}

export const workflowTaskProvider: CalendarSourceProvider = {
  key: KEY,
  async fetchEvents(range: NormalizedRange, _ctx: FeedContext): Promise<SourceResult> {
    try {
      const rows = await findWorkflowTasksInRange(range);
      return { events: rows.map(toRawEvent), statuses: [{ key: KEY, state: "ok", lastFetchedAt: null, error: null }] };
    } catch (e) {
      return { events: [], statuses: [{ key: KEY, state: "failed", lastFetchedAt: null, error: e instanceof Error ? e.message : String(e) }] };
    }
  },
};
```

`src/modules/calendar/sources/manual.ts`:

```ts
import type { CalendarSourceProvider, FeedContext, NormalizedRange, RawEvent, SourceResult } from "../types";
import { findManualEventsInRange, type ManualRow } from "../repositories";

const KEY = "manual";

function toRawEvent(m: ManualRow): RawEvent {
  return {
    id: `manual:${m.id}`,
    kind: m.kind,
    title: m.title,
    description: m.description,
    start: m.startsAt,
    end: m.endsAt,
    allDay: m.allDay,
    userId: m.userId,
    sourceKey: m.sourceKey,
    externalId: null,
    dedupStatus: "UNIQUE",
    duplicateOfId: null,
  };
}

export const manualProvider: CalendarSourceProvider = {
  key: KEY,
  async fetchEvents(range: NormalizedRange, _ctx: FeedContext): Promise<SourceResult> {
    try {
      const rows = await findManualEventsInRange(range);
      return { events: rows.map(toRawEvent), statuses: [{ key: KEY, state: "ok", lastFetchedAt: null, error: null }] };
    } catch (e) {
      return { events: [], statuses: [{ key: KEY, state: "failed", lastFetchedAt: null, error: e instanceof Error ? e.message : String(e) }] };
    }
  },
};
```

실행(PASS): `npm test -- tests/modules/calendar/sources/internal.test.ts`

### 3. commit

```
git add src/modules/calendar/sources tests/modules/calendar/sources/internal.test.ts
git commit -m "calendar: add internal source providers (leave/workflow/manual)"
```

## Acceptance Criteria

- `npm test -- tests/modules/calendar/sources/internal.test.ts` → PASS.
- `npm run typecheck` / `npm run lint` → OK.

## Cautions

- **internal provider에서 title에 사유(reason)를 직접 넣지 말 것.** 이유: 마스킹 이전 단계라 reason은 `description`에만 둔다. title은 일반 라벨("휴가")로 두고, 권한 있는 뷰어에게만 description이 노출되게 Task 07 masking이 처리한다.
- **provider가 throw하도록 두지 말 것.** 이유: feed가 allSettled로도 잡지만, provider별 `failedSources` 신호를 정확히 주려면 내부에서 try/catch로 `state:"failed"`를 반환한다.
