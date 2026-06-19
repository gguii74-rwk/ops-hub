import { describe, it, expect } from "vitest";
import {
  toKstDateKey,
  kstDayStartUtc,
  allDayHalfOpen,
  normalizeToGridWindow,
  rangesOverlap,
  isAnchorWithinWindow,
} from "@/modules/calendar/time";

describe("toKstDateKey", () => {
  it("KST 자정 경계를 넘은 UTC는 다음 날로 키 매김", () => {
    // 2026-06-18T15:30:00Z = 2026-06-19 00:30 KST
    expect(toKstDateKey(new Date("2026-06-18T15:30:00Z"))).toBe("2026-06-19");
    // 2026-06-18T14:30:00Z = 2026-06-18 23:30 KST
    expect(toKstDateKey(new Date("2026-06-18T14:30:00Z"))).toBe("2026-06-18");
  });
});

describe("kstDayStartUtc", () => {
  it("KST 그 날 00:00의 UTC instant", () => {
    // KST 2026-06-19 00:00 = UTC 2026-06-18T15:00:00Z
    expect(kstDayStartUtc(new Date("2026-06-18T15:30:00Z")).toISOString()).toBe(
      "2026-06-18T15:00:00.000Z",
    );
  });
});

describe("allDayHalfOpen", () => {
  it("동일 KST 일 → [그날 00:00 KST, 다음날 00:00 KST)", () => {
    const r = allDayHalfOpen(new Date("2026-06-19T02:00:00+09:00"), new Date("2026-06-19T20:00:00+09:00"));
    expect(r.start.toISOString()).toBe("2026-06-18T15:00:00.000Z"); // 06-19 00:00 KST
    expect(r.end.toISOString()).toBe("2026-06-19T15:00:00.000Z"); // 06-20 00:00 KST
  });
});

describe("normalizeToGridWindow", () => {
  it("2026-06 → 6주 창(일요일 시작), 길이 42일", () => {
    // 2026-06-01 = 월요일, WEEK_STARTS_ON=0 → 그리드 시작 2026-05-31(일)
    const r = normalizeToGridWindow(new Date("2026-06-15T03:00:00+09:00"));
    expect(r.start.toISOString()).toBe("2026-05-30T15:00:00.000Z"); // 05-31 00:00 KST
    expect(r.end.toISOString()).toBe("2026-07-11T15:00:00.000Z"); // 07-12 00:00 KST
    expect((r.end.getTime() - r.start.getTime()) / 86_400_000).toBe(42);
  });

  it("같은 달의 다른 anchor는 같은 창으로 정규화", () => {
    const a = normalizeToGridWindow(new Date("2026-06-01T00:00:00+09:00"));
    const b = normalizeToGridWindow(new Date("2026-06-30T23:00:00+09:00"));
    expect(a.start.toISOString()).toBe(b.start.toISOString());
    expect(a.end.toISOString()).toBe(b.end.toISOString());
  });
});

describe("rangesOverlap", () => {
  it("반열림 겹침: 접하면 false, 겹치면 true", () => {
    const d = (s: string) => new Date(s);
    expect(rangesOverlap(d("2026-06-01"), d("2026-06-03"), d("2026-06-03"), d("2026-06-05"))).toBe(false);
    expect(rangesOverlap(d("2026-06-01"), d("2026-06-04"), d("2026-06-03"), d("2026-06-05"))).toBe(true);
  });
});

describe("isAnchorWithinWindow", () => {
  const now = new Date("2026-06-15T03:00:00+09:00"); // 2026-06 KST

  it("같은 달·±maxMonths 경계 내 → true", () => {
    expect(isAnchorWithinWindow(new Date("2026-06-01T00:00:00+09:00"), now, 12)).toBe(true);
    expect(isAnchorWithinWindow(new Date("2027-06-15T00:00:00+09:00"), now, 12)).toBe(true); // +12개월 경계
    expect(isAnchorWithinWindow(new Date("2025-06-15T00:00:00+09:00"), now, 12)).toBe(true); // -12개월 경계
  });

  it("창 밖 → false", () => {
    expect(isAnchorWithinWindow(new Date("2027-07-15T00:00:00+09:00"), now, 12)).toBe(false); // +13개월
    expect(isAnchorWithinWindow(new Date("2025-05-15T00:00:00+09:00"), now, 12)).toBe(false); // -13개월
    expect(isAnchorWithinWindow(new Date("1900-01-01T00:00:00+09:00"), now, 12)).toBe(false);
  });
});
