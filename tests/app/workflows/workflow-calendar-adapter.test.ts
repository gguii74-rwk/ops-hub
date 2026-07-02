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
