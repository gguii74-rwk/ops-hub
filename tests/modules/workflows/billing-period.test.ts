import { describe, it, expect } from "vitest";
import { computeBillingPeriod, toKstFields, getLastDayOfMonth } from "@/modules/workflows/billing/period";

describe("computeBillingPeriod (J2 KST 전월 기준)", () => {
  it("KST 3월 1일 자정(=2/28 15:00Z) → 전월=2월(UTC 서버 오산 방지)", () => {
    const r = computeBillingPeriod(new Date("2026-02-28T15:00:00Z"));
    expect(r.projectYear).toBe(2026);
    expect(r.round).toBe(2);
  });
  it("일반: KST 6월 15일 → 전월=5월", () => {
    const r = computeBillingPeriod(new Date("2026-06-15T03:00:00Z")); // KST 12:00
    expect(r.projectYear).toBe(2026);
    expect(r.round).toBe(5);
  });
  it("1월 경계: KST 1월 → 전월=전년 12월", () => {
    const r = computeBillingPeriod(new Date("2026-01-15T03:00:00Z"));
    expect(r.projectYear).toBe(2025);
    expect(r.round).toBe(12);
  });
  it("월 첫날 자정(KST) 경계: 6/1 00:00 KST = 5/31 15:00Z → 전월=5월", () => {
    const r = computeBillingPeriod(new Date("2026-05-31T15:00:00Z"));
    expect(r.projectYear).toBe(2026);
    expect(r.round).toBe(5);
  });
  it("billingDate는 입력 instant 그대로", () => {
    const d = new Date("2026-06-15T03:00:00Z");
    expect(computeBillingPeriod(d).billingDate.getTime()).toBe(d.getTime());
  });
});

describe("toKstFields / getLastDayOfMonth", () => {
  it("toKstFields: 2/28 15:00Z → KST 3/1", () => {
    expect(toKstFields(new Date("2026-02-28T15:00:00Z"))).toEqual({ year: 2026, month: 3, day: 1 });
  });
  it("toKstFields: 6/15 03:00Z → KST 6/15 12:00", () => {
    expect(toKstFields(new Date("2026-06-15T03:00:00Z"))).toEqual({ year: 2026, month: 6, day: 15 });
  });
  it("getLastDayOfMonth: 2026-02→28, 2024-02(윤년)→29, 2026-12→31", () => {
    expect(getLastDayOfMonth(2026, 2)).toBe(28);
    expect(getLastDayOfMonth(2024, 2)).toBe(29);
    expect(getLastDayOfMonth(2026, 12)).toBe(31);
  });
});
