# Task 02 — calendar repository (Prisma 직접 조회)

calendar 모듈이 소유하는 데이터 접근 계층. 권위 테이블(`LeaveRequest`/`WorkflowTask`)·수동 이벤트·`CalendarSource`·`CalendarCacheEntry`를 `@/lib/prisma`로 직접 조회한다. **Prisma는 이 파일에서만 잡는다**(provider는 여기만 호출 — §4.1).

## Files

- Create: `src/modules/calendar/repositories/index.ts`
- Test: `tests/modules/calendar/repository.test.ts`

## Prep

- Spec §3(출처별 처리), §4.1(경계), §12.1(인덱스).
- 엔트리포인트 §Shared Contracts의 repository 시그니처·`NormalizedRange` 타입.
- 테스트 패턴: `tests/kernel/settings/repository.test.ts`의 `vi.hoisted` + `vi.mock("@/lib/prisma", …)` in-memory fake.

## Deps

01 (types, NormalizedRange).

## Steps

### 1. 테스트 먼저 작성 (FAIL 확인)

`tests/modules/calendar/repository.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const { rows, calls, keyOf } = vi.hoisted(() => {
  const rows: any = { leave: [], workflow: [], manual: [], sources: [], cache: new Map<string, any>() };
  const calls: any = {};
  const keyOf = (w: any) => `${w.sourceId}|${w.rangeStart.toISOString()}|${w.rangeEnd.toISOString()}`;
  return { rows, calls, keyOf };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    leaveRequest: { findMany: async (a: any) => ((calls.leave = a), rows.leave) },
    workflowTask: { findMany: async (a: any) => ((calls.workflow = a), rows.workflow) },
    calendarEvent: { findMany: async (a: any) => ((calls.manual = a), rows.manual) },
    calendarSource: { findMany: async (a: any) => ((calls.sources = a), rows.sources) },
    calendarCacheEntry: {
      findUnique: async (a: any) => {
        calls.cacheRead = a;
        return rows.cache.get(keyOf(a.where.sourceId_rangeStart_rangeEnd)) ?? null;
      },
      upsert: async (a: any) => {
        const w = a.where.sourceId_rangeStart_rangeEnd;
        const k = keyOf(w);
        const existing = rows.cache.get(k);
        const row = existing
          ? { ...existing, ...a.update }
          : { ...a.create, fetchedAt: a.create.fetchedAt ?? new Date("2026-01-01T00:00:00Z") };
        rows.cache.set(k, row);
        return row;
      },
    },
  },
}));

import {
  findLeaveInRange,
  findWorkflowTasksInRange,
  findManualEventsInRange,
  findSourcesByKind,
  readCacheEntry,
  writeCacheEntry,
} from "@/modules/calendar/repositories";

const range = { start: new Date("2026-05-30T15:00:00Z"), end: new Date("2026-07-11T15:00:00Z") };

beforeEach(() => {
  rows.leave = [];
  rows.workflow = [];
  rows.manual = [];
  rows.sources = [];
  rows.cache.clear();
  for (const k of Object.keys(calls)) delete calls[k];
});

describe("findLeaveInRange", () => {
  it("status in + 겹침 조건으로 조회하고 LeaveRow로 매핑", async () => {
    rows.leave = [
      { id: "l1", userId: "u1", leaveType: "ANNUAL", reason: "여행", startDate: new Date("2026-06-10"), endDate: new Date("2026-06-11"), status: "APPROVED" },
    ];
    const out = await findLeaveInRange(range, ["APPROVED"]);
    expect(out).toEqual([
      { id: "l1", userId: "u1", leaveType: "ANNUAL", reason: "여행", startDate: new Date("2026-06-10"), endDate: new Date("2026-06-11"), status: "APPROVED" },
    ]);
    expect(calls.leave.where.status).toEqual({ in: ["APPROVED"] });
    expect(calls.leave.where.startDate).toEqual({ lt: range.end });
    expect(calls.leave.where.endDate).toEqual({ gte: range.start });
  });
});

describe("findWorkflowTasksInRange", () => {
  it("scheduledAt 창 조회 + type.name → title", async () => {
    rows.workflow = [{ id: "w1", scheduledAt: new Date("2026-06-12"), status: "PENDING", type: { name: "주간보고" } }];
    const out = await findWorkflowTasksInRange(range);
    expect(out).toEqual([{ id: "w1", title: "주간보고", scheduledAt: new Date("2026-06-12"), status: "PENDING" }]);
    expect(calls.workflow.where.scheduledAt).toEqual({ gte: range.start, lt: range.end });
  });
});

describe("findManualEventsInRange", () => {
  it("PERSONAL/TEAM kind + 겹침 조회, source.key → sourceKey", async () => {
    rows.manual = [
      { id: "m1", kind: "TEAM_EVENT", title: "팀 공지", description: null, startsAt: new Date("2026-06-12"), endsAt: new Date("2026-06-12T10:00:00Z"), allDay: false, userId: null, source: { key: "manual-team" } },
    ];
    const out = await findManualEventsInRange(range);
    expect(out[0]).toEqual({ id: "m1", kind: "TEAM_EVENT", title: "팀 공지", description: null, startsAt: new Date("2026-06-12"), endsAt: new Date("2026-06-12T10:00:00Z"), allDay: false, userId: null, sourceKey: "manual-team" });
    expect(calls.manual.where.kind).toEqual({ in: ["PERSONAL_EVENT", "TEAM_EVENT"] });
  });

  it("source 없는 행은 sourceKey='manual' 폴백", async () => {
    rows.manual = [{ id: "m2", kind: "PERSONAL_EVENT", title: "개인", description: null, startsAt: new Date("2026-06-12"), endsAt: new Date("2026-06-13"), allDay: true, userId: "u1", source: null }];
    const out = await findManualEventsInRange(range);
    expect(out[0].sourceKey).toBe("manual");
  });
});

describe("findSourcesByKind", () => {
  it("kind in + ACTIVE만 조회", async () => {
    rows.sources = [{ id: "s1", key: "google-team", externalId: "abc@group", name: "팀 캘린더", cacheTtlSeconds: 900 }];
    const out = await findSourcesByKind(["GOOGLE_CALENDAR"]);
    expect(out).toEqual(rows.sources);
    expect(calls.sources.where.kind).toEqual({ in: ["GOOGLE_CALENDAR"] });
    expect(calls.sources.where.syncStatus).toBe("ACTIVE");
  });
});

describe("cache round-trip", () => {
  it("writeCacheEntry 후 readCacheEntry가 payload 반환", async () => {
    await writeCacheEntry("s1", range, { events: [1, 2] }, new Date("2026-06-19T00:00:00Z"), null);
    const row = await readCacheEntry("s1", range);
    expect(row?.payload).toEqual({ events: [1, 2] });
    expect(row?.errorMessage).toBeNull();
  });

  it("없으면 null", async () => {
    expect(await readCacheEntry("nope", range)).toBeNull();
  });
});
```

실행(FAIL): `npm test -- tests/modules/calendar/repository.test.ts`

### 2. 구현 (PASS 확인)

`src/modules/calendar/repositories/index.ts`:

```ts
import type { Prisma, LeaveRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { NormalizedRange } from "../types";

export interface LeaveRow {
  id: string;
  userId: string;
  leaveType: string;
  reason: string | null;
  startDate: Date;
  endDate: Date;
  status: LeaveRequestStatus;
}
export interface WorkflowRow {
  id: string;
  title: string;
  scheduledAt: Date;
  status: string;
}
export interface ManualRow {
  id: string;
  kind: "PERSONAL_EVENT" | "TEAM_EVENT";
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  userId: string | null;
  sourceKey: string;
}
export interface SourceRow {
  id: string;
  key: string;
  externalId: string | null;
  name: string;
  cacheTtlSeconds: number;
}
export interface CacheRow {
  payload: unknown;
  fetchedAt: Date;
  expiresAt: Date;
  errorMessage: string | null;
}

export async function findLeaveInRange(range: NormalizedRange, statuses: LeaveRequestStatus[]): Promise<LeaveRow[]> {
  const rows = await prisma.leaveRequest.findMany({
    where: { status: { in: statuses }, startDate: { lt: range.end }, endDate: { gte: range.start } },
    select: { id: true, userId: true, leaveType: true, reason: true, startDate: true, endDate: true, status: true },
    orderBy: { startDate: "asc" },
  });
  return rows.map((r) => ({ ...r, leaveType: String(r.leaveType) }));
}

export async function findWorkflowTasksInRange(range: NormalizedRange): Promise<WorkflowRow[]> {
  const rows = await prisma.workflowTask.findMany({
    where: { scheduledAt: { gte: range.start, lt: range.end } },
    select: { id: true, scheduledAt: true, status: true, type: { select: { name: true } } },
    orderBy: { scheduledAt: "asc" },
  });
  return rows.map((r) => ({ id: r.id, title: r.type.name, scheduledAt: r.scheduledAt, status: String(r.status) }));
}

export async function findManualEventsInRange(range: NormalizedRange): Promise<ManualRow[]> {
  const rows = await prisma.calendarEvent.findMany({
    where: { kind: { in: ["PERSONAL_EVENT", "TEAM_EVENT"] }, startsAt: { lt: range.end }, endsAt: { gt: range.start } },
    select: { id: true, kind: true, title: true, description: true, startsAt: true, endsAt: true, allDay: true, userId: true, source: { select: { key: true } } },
    orderBy: { startsAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as "PERSONAL_EVENT" | "TEAM_EVENT",
    title: r.title,
    description: r.description,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    allDay: r.allDay,
    userId: r.userId,
    sourceKey: r.source?.key ?? "manual",
  }));
}

export async function findSourcesByKind(kinds: Array<"GOOGLE_CALENDAR" | "HOLIDAY">): Promise<SourceRow[]> {
  return prisma.calendarSource.findMany({
    where: { kind: { in: kinds }, syncStatus: "ACTIVE" },
    select: { id: true, key: true, externalId: true, name: true, cacheTtlSeconds: true },
  });
}

export async function readCacheEntry(sourceId: string, range: NormalizedRange): Promise<CacheRow | null> {
  return prisma.calendarCacheEntry.findUnique({
    where: { sourceId_rangeStart_rangeEnd: { sourceId, rangeStart: range.start, rangeEnd: range.end } },
    select: { payload: true, fetchedAt: true, expiresAt: true, errorMessage: true },
  });
}

export async function writeCacheEntry(
  sourceId: string,
  range: NormalizedRange,
  payload: unknown,
  expiresAt: Date,
  errorMessage: string | null,
): Promise<void> {
  await prisma.calendarCacheEntry.upsert({
    where: { sourceId_rangeStart_rangeEnd: { sourceId, rangeStart: range.start, rangeEnd: range.end } },
    create: { sourceId, rangeStart: range.start, rangeEnd: range.end, payload: payload as Prisma.InputJsonValue, expiresAt, errorMessage },
    update: { payload: payload as Prisma.InputJsonValue, expiresAt, errorMessage, fetchedAt: new Date() },
  });
}
```

실행(PASS): `npm test -- tests/modules/calendar/repository.test.ts`

### 3. commit

```
git add src/modules/calendar/repositories tests/modules/calendar/repository.test.ts
git commit -m "calendar: add repository (leave/workflow/manual/source/cache reads)"
```

## Acceptance Criteria

- `npm test -- tests/modules/calendar/repository.test.ts` → PASS.
- `npm run typecheck` → 에러 없음.
- `npm run lint` → boundaries OK(repository는 lib/prisma만 import).

## Cautions

- **provider가 직접 prisma를 import하게 두지 말 것.** 이유: §4.1 계층 규약. 모든 DB 접근은 이 repository를 경유한다.
- **leave 겹침 조건을 `startDate >= range.start AND endDate <= range.end`로 쓰지 말 것.** 이유: 창에 걸친(부분 겹침) 휴가가 누락된다. 반열림 겹침은 `startDate < end && endDate >= start`다.
- **cache 키에 원본 요청 range를 넣지 말 것.** 이유: Task 06이 호출 전 `normalizeToGridWindow`로 정규화한 range만 넘긴다(단편화 차단). repository는 받은 range를 그대로 키로 쓴다.
