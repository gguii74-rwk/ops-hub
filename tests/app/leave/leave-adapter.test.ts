import { describe, it, expect } from "vitest";
import { leaveToEvents, type Ev } from "@/app/(app)/leave/_components/leave-adapter";
import { eventDayKeys } from "@/modules/calendar/ui/lanes";

function lv(p: Partial<Ev>): Ev {
  return {
    id: "l", userId: "u", name: "홍길동", leaveType: "ANNUAL",
    leaveSubType: null, quarterStartTime: null,
    startDate: "2026-06-01T00:00:00.000Z", endDate: "2026-06-03T00:00:00.000Z",
    status: "APPROVED", isSelf: true, ...p,
  };
}

describe("leaveToEvents (D14② inclusive→half-open)", () => {
  it("inclusive 6/1~6/3 → 정확히 3일 점유(하루 모자람 없음)", () => {
    const [e] = leaveToEvents([lv({})]);
    expect(eventDayKeys(e)).toEqual({ firstKey: "2026-06-01", lastKey: "2026-06-03" });
  });
  it("단일일(반차, start=end) → 1일 점유", () => {
    const [e] = leaveToEvents([
      lv({ leaveType: "HALF", leaveSubType: "MORNING", startDate: "2026-06-05T00:00:00.000Z", endDate: "2026-06-05T00:00:00.000Z" }),
    ]);
    expect(eventDayKeys(e)).toEqual({ firstKey: "2026-06-05", lastKey: "2026-06-05" });
  });
  it("kind=leaveType, status 그대로, title=이름+휴가텍스트", () => {
    const [e] = leaveToEvents([lv({ name: "김철수", leaveType: "QUARTER", quarterStartTime: "09:00", status: "PENDING" })]);
    expect(e.kind).toBe("QUARTER");
    expect(e.status).toBe("PENDING");
    expect(e.title).toContain("김철수");
    expect(e.title).toContain("반반차");
  });
});
