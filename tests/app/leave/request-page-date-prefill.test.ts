import { describe, it, expect } from "vitest";
import { QUARTER_TIME_SLOTS, QUARTER_START_TIMES } from "@/modules/leave/labels";

// ?date prefill 검증 로직(page.tsx 인라인 regex 동일)
function resolveValidDate(date: string | undefined): string | undefined {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

describe("신청 폼 ?date prefill — 날짜 형식 검증", () => {
  it("YYYY-MM-DD 형식은 통과", () => {
    expect(resolveValidDate("2026-07-01")).toBe("2026-07-01");
    expect(resolveValidDate("2026-12-31")).toBe("2026-12-31");
  });

  it("잘못된 형식은 undefined 반환", () => {
    expect(resolveValidDate("20260701")).toBeUndefined();        // 구분자 없음
    expect(resolveValidDate("2026-7-1")).toBeUndefined();        // 0 패딩 없음
    expect(resolveValidDate("invalid")).toBeUndefined();          // 임의 문자열
    expect(resolveValidDate("2026/07/01")).toBeUndefined();      // 슬래시 구분자
    expect(resolveValidDate("")).toBeUndefined();                 // 빈 문자열
    expect(resolveValidDate(undefined)).toBeUndefined();          // 없는 쿼리
  });
});

describe("신청 폼 반반차 — QUARTER_TIME_SLOTS 6종", () => {
  it("6종 시간대 슬롯이 존재한다", () => {
    expect(QUARTER_TIME_SLOTS).toHaveLength(6);
  });

  it("모든 슬롯이 start·end·label 필드를 갖는다", () => {
    for (const slot of QUARTER_TIME_SLOTS) {
      expect(slot).toHaveProperty("start");
      expect(slot).toHaveProperty("end");
      expect(slot).toHaveProperty("label");
    }
  });

  it("start 시각이 검증 화이트리스트와 일치한다", () => {
    const starts = QUARTER_TIME_SLOTS.map((s) => s.start);
    expect(starts).toEqual(QUARTER_START_TIMES);
  });

  it("자유 시각(12:00, 08:00)은 화이트리스트에 없다", () => {
    expect(QUARTER_START_TIMES).not.toContain("12:00");
    expect(QUARTER_START_TIMES).not.toContain("08:00");
  });
});
