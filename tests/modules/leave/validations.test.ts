import { describe, it, expect } from "vitest";
import { createLeaveSchema, updateLeaveSchema, deleteLeaveSchema } from "@/modules/leave/validations";

const base = { startDate: "2026-07-01", endDate: "2026-07-01" };

describe("createLeaveSchema — 반반차 화이트리스트", () => {
  it("6종 외 시작시각 거부", () => {
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "QUARTER", quarterStartTime: "12:00" }).success).toBe(false);
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "QUARTER", quarterStartTime: "09:30" }).success).toBe(false);
  });
  it("6종 중 하나는 통과", () => {
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "QUARTER", quarterStartTime: "11:00" }).success).toBe(true);
  });
  it("QUARTER인데 quarterStartTime 없으면 거부", () => {
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "QUARTER" }).success).toBe(false);
  });
  it("HALF인데 leaveSubType 없으면 거부", () => {
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "HALF" }).success).toBe(false);
  });
  it("HALF + MORNING 통과", () => {
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "HALF", leaveSubType: "MORNING" }).success).toBe(true);
  });
  it("ANNUAL은 sub 필드 불필요", () => {
    expect(createLeaveSchema.safeParse({ ...base, leaveType: "ANNUAL" }).success).toBe(true);
  });
});

describe("updateLeaveSchema — 화이트리스트만(부분 수정)", () => {
  it("6종 외 시각 거부", () => {
    expect(updateLeaveSchema.safeParse({ quarterStartTime: "08:00" }).success).toBe(false);
  });
  it("빈 패치 허용(부분 수정)", () => {
    expect(updateLeaveSchema.safeParse({}).success).toBe(true);
  });
});

describe("deleteLeaveSchema — 삭제 사유 필수", () => {
  it("사유 누락 거부", () => {
    expect(deleteLeaveSchema.safeParse({}).success).toBe(false);
  });
  it("공백만인 사유 거부(trim 후 빈 문자열)", () => {
    expect(deleteLeaveSchema.safeParse({ reason: "   " }).success).toBe(false);
  });
  it("비어있지 않은 사유 통과", () => {
    expect(deleteLeaveSchema.safeParse({ reason: "오기재 정정" }).success).toBe(true);
  });
});
