import { describe, it, expect } from "vitest";
import {
  toDateKey, parseLeaveDate, calculateLeaveDays, validateDates,
  validateDatesForAdmin, validateLeaveTypeDates, calculateCarriedOverExpiry, kstToday,
} from "@/modules/leave/rules";
import { LeaveValidationError } from "@/modules/leave/errors";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("calculateLeaveDays", () => {
  it("ANNUAL: 평일 5일(월~금)", () => {
    expect(calculateLeaveDays("ANNUAL", d("2026-08-10"), d("2026-08-14"), new Set())).toBe(5); // 월~금
  });
  it("ANNUAL: 주말 제외", () => {
    expect(calculateLeaveDays("ANNUAL", d("2026-08-14"), d("2026-08-17"), new Set())).toBe(2); // 금,월 (토일 제외)
  });
  it("ANNUAL: 공휴일 제외", () => {
    const holidays = new Set(["2026-08-17"]); // 가상 공휴일(월)
    expect(calculateLeaveDays("ANNUAL", d("2026-08-14"), d("2026-08-17"), holidays)).toBe(1); // 금만
  });
  it("HALF=0.5, QUARTER=0.25", () => {
    expect(calculateLeaveDays("HALF", d("2026-08-14"), d("2026-08-14"), new Set())).toBe(0.5);
    expect(calculateLeaveDays("QUARTER", d("2026-08-14"), d("2026-08-14"), new Set())).toBe(0.25);
  });
});

describe("validateDates (직원)", () => {
  const today = d("2026-08-14");
  it("과거 거부", () => {
    expect(() => validateDates(d("2026-08-13"), d("2026-08-13"), today)).toThrow(LeaveValidationError);
  });
  it("start>end 거부", () => {
    expect(() => validateDates(d("2026-08-20"), d("2026-08-19"), today)).toThrow(LeaveValidationError);
  });
  it("당일·미래 허용", () => {
    expect(() => validateDates(d("2026-08-14"), d("2026-08-15"), today)).not.toThrow();
  });
});

describe("validateDatesForAdmin", () => {
  it("과거 허용, start>end만 거부", () => {
    expect(() => validateDatesForAdmin(d("2020-01-01"), d("2020-01-02"))).not.toThrow();
    expect(() => validateDatesForAdmin(d("2026-08-20"), d("2026-08-19"))).toThrow(LeaveValidationError);
  });
});

describe("validateLeaveTypeDates", () => {
  it("HALF 여러 날 거부, 단일일 허용", () => {
    expect(() => validateLeaveTypeDates("HALF", d("2026-08-14"), d("2026-08-15"))).toThrow(LeaveValidationError);
    expect(() => validateLeaveTypeDates("HALF", d("2026-08-14"), d("2026-08-14"))).not.toThrow();
    expect(() => validateLeaveTypeDates("ANNUAL", d("2026-08-14"), d("2026-08-15"))).not.toThrow();
  });
});

describe("기타", () => {
  it("calculateCarriedOverExpiry → 익년 6/30(UTC)", () => {
    expect(toDateKey(calculateCarriedOverExpiry(2026))).toBe("2027-06-30");
  });
  it("parseLeaveDate 형식 위반 throw", () => {
    expect(() => parseLeaveDate("2026/08/14")).toThrow(LeaveValidationError);
    expect(toDateKey(parseLeaveDate("2026-08-14"))).toBe("2026-08-14");
  });
  it("kstToday: KST 자정 경계", () => {
    // 2026-08-14 23:00 UTC = 2026-08-15 08:00 KST
    expect(toDateKey(kstToday(new Date("2026-08-14T23:00:00.000Z")))).toBe("2026-08-15");
  });
});
