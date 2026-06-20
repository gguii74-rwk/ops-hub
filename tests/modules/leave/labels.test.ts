import { describe, it, expect } from "vitest";
import {
  QUARTER_TIME_SLOTS, QUARTER_START_TIMES,
  getLeaveTypeText, getLeaveSubTypeText, getQuarterEndTime, getQuarterTimeText, getFullLeaveText,
} from "@/modules/leave/labels";

describe("leave labels — 시간대", () => {
  it("반반차 6종 시작시각", () => {
    expect(QUARTER_START_TIMES).toEqual(["09:00", "10:00", "11:00", "13:00", "15:00", "16:00"]);
    expect(QUARTER_TIME_SLOTS).toHaveLength(6);
  });
  it("getQuarterEndTime: 11시는 점심 포함 14:00, 그 외 +2h", () => {
    expect(getQuarterEndTime("11:00")).toBe("14:00");
    expect(getQuarterEndTime("09:00")).toBe("11:00");
    expect(getQuarterEndTime("16:00")).toBe("18:00");
  });
  it("getQuarterTimeText", () => {
    expect(getQuarterTimeText("13:00")).toBe("13:00~15:00");
    expect(getQuarterTimeText("11:00")).toBe("11:00~14:00");
  });
});

describe("leave labels — 표시 텍스트", () => {
  it("getLeaveTypeText / getLeaveSubTypeText", () => {
    expect(getLeaveTypeText("ANNUAL")).toBe("연차");
    expect(getLeaveTypeText("HALF")).toBe("반차");
    expect(getLeaveTypeText("QUARTER")).toBe("반반차");
    expect(getLeaveSubTypeText("MORNING")).toBe("오전 반차");
    expect(getLeaveSubTypeText("AFTERNOON")).toBe("오후 반차");
  });
  it("getFullLeaveText: 유형+세부 결합", () => {
    expect(getFullLeaveText("ANNUAL")).toBe("연차");
    expect(getFullLeaveText("HALF", "MORNING")).toBe("오전 반차");
    expect(getFullLeaveText("QUARTER", null, "09:00")).toBe("반반차 09:00~11:00");
  });
});
