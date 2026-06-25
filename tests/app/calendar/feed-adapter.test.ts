import { describe, it, expect } from "vitest";
import { feedToEvents } from "@/app/(app)/calendar/feed-adapter";
import { eventDayKeys } from "@/modules/calendar/ui/lanes";
import type { CalEvent } from "@/modules/calendar/types";

function cal(p: Partial<CalEvent>): CalEvent {
  return {
    id: "c", kind: "WORKFLOW_TASK", title: "t", description: null,
    start: "2026-06-01T00:00:00+09:00", end: "2026-06-04T00:00:00+09:00", // half-open: 06-01~03
    allDay: true, userId: null, sourceKey: "s", dedupStatus: "UNIQUE", masked: false, tentative: false, ...p,
  };
}

describe("feedToEvents (D14① passthrough)", () => {
  it("start/end 그대로 — half-open 점유 정확(06-01~03, 06-04 미점유)", () => {
    const [e] = feedToEvents([cal({})]);
    expect(eventDayKeys(e)).toEqual({ firstKey: "2026-06-01", lastKey: "2026-06-03" });
  });
  it("tentative → status PENDING, 아니면 null", () => {
    expect(feedToEvents([cal({ tentative: true })])[0].status).toBe("PENDING");
    expect(feedToEvents([cal({ tentative: false })])[0].status).toBeNull();
  });
  it("kind/title/id passthrough", () => {
    const [e] = feedToEvents([cal({ id: "x", kind: "HOLIDAY", title: "현충일" })]);
    expect([e.id, e.kind, e.title]).toEqual(["x", "HOLIDAY", "현충일"]);
  });
});
