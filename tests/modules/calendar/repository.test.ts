import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

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
  const viewer = { userId: "u1", includeAllPersonal: false };

  it("TEAM은 전체, PERSONAL은 본인만 + 겹침 조회, source.key → sourceKey", async () => {
    rows.manual = [
      { id: "m1", kind: "TEAM_EVENT", title: "팀 공지", description: null, startsAt: new Date("2026-06-12"), endsAt: new Date("2026-06-12T10:00:00Z"), allDay: false, userId: null, source: { key: "manual-team" } },
    ];
    const out = await findManualEventsInRange(range, viewer);
    expect(out[0]).toEqual({ id: "m1", kind: "TEAM_EVENT", title: "팀 공지", description: null, startsAt: new Date("2026-06-12"), endsAt: new Date("2026-06-12T10:00:00Z"), allDay: false, userId: null, sourceKey: "manual-team" });
    // 비-admin: PERSONAL은 본인(u1)으로 필터, TEAM은 전체 → 타인 개인 일정은 애초에 조회되지 않음
    expect(calls.manual.where.OR).toEqual([
      { kind: "TEAM_EVENT" },
      { kind: "PERSONAL_EVENT", userId: "u1" },
    ]);
  });

  it("includeAllPersonal(admin) → PERSONAL도 전체 조회", async () => {
    rows.manual = [];
    await findManualEventsInRange(range, { userId: "u1", includeAllPersonal: true });
    expect(calls.manual.where.OR).toEqual([
      { kind: "TEAM_EVENT" },
      { kind: "PERSONAL_EVENT" },
    ]);
  });

  it("source 없는 행은 sourceKey='manual' 폴백", async () => {
    rows.manual = [{ id: "m2", kind: "PERSONAL_EVENT", title: "개인", description: null, startsAt: new Date("2026-06-12"), endsAt: new Date("2026-06-13"), allDay: true, userId: "u1", source: null }];
    const out = await findManualEventsInRange(range, viewer);
    expect(out[0].sourceKey).toBe("manual");
  });
});

describe("findSourcesByKind", () => {
  it("kind in + ACTIVE만 조회", async () => {
    rows.sources = [{ id: "s1", key: "google-team", externalId: "abc@group", name: "팀 캘린더", cacheTtlSeconds: 900, ownerUserId: null }];
    const out = await findSourcesByKind(["GOOGLE_CALENDAR"]);
    expect(out).toEqual(rows.sources);
    expect(calls.sources.where.kind).toEqual({ in: ["GOOGLE_CALENDAR"] });
    expect(calls.sources.where.syncStatus).toBe("ACTIVE");
    expect(calls.sources.select.ownerUserId).toBe(true);
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

  it("null payload → cold-failure marker (writeCacheEntry maps null → Prisma.JsonNull)", async () => {
    await writeCacheEntry("s1", range, null, new Date("2026-06-19T00:00:00Z"), "fetch failed");
    const row = await readCacheEntry("s1", range);
    // 콜드 실패 마커: writeCacheEntry가 null → Prisma.JsonNull로 변환해 기록한다(§Task 03 warm/cold 구분).
    // 인메모리 fake는 센티넬을 그대로 저장하므로 여기선 센티넬을 단언한다.
    // 실제 Postgres는 JSON null을 JS null로 역직렬화하므로 production의 readCacheEntry는 null을 돌려준다
    // (그 end-to-end 왕복은 실DB 통합 테스트에서 핀 — Task 03/통합 단계).
    expect(row?.payload).toBe(Prisma.JsonNull);
    expect(row?.errorMessage).toBe("fetch failed");
  });
});
