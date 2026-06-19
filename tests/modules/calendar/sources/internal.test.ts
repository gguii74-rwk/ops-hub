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
  it("APPROVED LeaveRow → INTERNAL_LEAVE RawEvent (all-day, KST 반열림, reason→description, tentative false)", async () => {
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
        tentative: false,
      },
    ]);
    expect(h.leave).toHaveBeenCalledWith(range, ["APPROVED", "PENDING"]);
  });

  it("PENDING LeaveRow → tentative true (잠정 — 본인/admin만, dedup 앵커 아님)", async () => {
    h.leave.mockResolvedValue([
      { id: "l2", userId: "u9", leaveType: "ANNUAL", reason: "신청중", startDate: new Date("2026-06-10"), endDate: new Date("2026-06-10"), status: "PENDING" },
    ]);
    const out = await internalLeaveProvider.fetchEvents(range, ctx);
    expect(out.events[0]).toMatchObject({ id: "leave:l2", kind: "INTERNAL_LEAVE", tentative: true });
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
    expect(out.events[0]).toMatchObject({ id: "workflow:w1", kind: "WORKFLOW_TASK", title: "주간보고", allDay: true, sourceKey: "workflowTask", userId: null, tentative: false });
    // 2026-06-12T01:00Z = 06-12 10:00 KST → 06-12 00:00 KST = 2026-06-11T15:00Z
    expect(out.events[0].start.toISOString()).toBe("2026-06-11T15:00:00.000Z");
    expect(out.events[0].end.toISOString()).toBe("2026-06-12T15:00:00.000Z");
  });

  it("repository throw → events 빈 배열 + failed status", async () => {
    h.wf.mockRejectedValue(new Error("wf db down"));
    const out = await workflowTaskProvider.fetchEvents(range, ctx);
    expect(out.events).toEqual([]);
    expect(out.statuses[0]).toEqual({ key: "workflowTask", state: "failed", lastFetchedAt: null, error: "wf db down" });
  });
});

describe("manualProvider", () => {
  it("repository throw → events 빈 배열 + failed status", async () => {
    h.manual.mockRejectedValue(new Error("manual db down"));
    const out = await manualProvider.fetchEvents(range, ctx);
    expect(out.events).toEqual([]);
    expect(out.statuses[0]).toEqual({ key: "manual", state: "failed", lastFetchedAt: null, error: "manual db down" });
  });

  it("ManualRow → RawEvent (kind·userId·sourceKey 보존, tentative false), 비-admin은 본인 PERSONAL만 조회", async () => {
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
      tentative: false,
    });
    expect(out.statuses[0].state).toBe("ok");
    // ctx 기반 viewer 전달: 비-admin → 본인 PERSONAL만(includeAllPersonal false)
    expect(h.manual).toHaveBeenCalledWith(range, { userId: "u1", includeAllPersonal: false });
  });

  it("calendar.admin:view 보유 → includeAllPersonal true(전체 PERSONAL 조회)", async () => {
    h.manual.mockResolvedValue([]);
    const adminCtx = { userId: "u1", isOwner: false, permissionKeys: new Set(["calendar.admin:view"]) };
    await manualProvider.fetchEvents(range, adminCtx);
    expect(h.manual).toHaveBeenCalledWith(range, { userId: "u1", includeAllPersonal: true });
  });
});
