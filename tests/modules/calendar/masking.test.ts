import { describe, it, expect } from "vitest";
import { maskEvent } from "@/modules/calendar/masking";
import type { RawEvent, FeedContext } from "@/modules/calendar/types";

function ev(p: Partial<RawEvent>): RawEvent {
  return {
    id: "x", kind: "INTERNAL_LEAVE", title: "휴가", description: "가족 여행",
    start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z"),
    allDay: true, userId: "u9", sourceKey: "internalLeave", externalId: null,
    dedupStatus: "UNIQUE", duplicateOfId: null, tentative: false, ...p,
  };
}
const ctx = (p: Partial<FeedContext>): FeedContext => ({ userId: "u1", isOwner: false, permissionKeys: new Set<string>(), ...p });

describe("maskEvent", () => {
  it("타인 휴가, 비권한 → 제목 일반화·사유 null·masked true", () => {
    const c = maskEvent(ev({ userId: "u9" }), ctx({ userId: "u1" }));
    expect(c.title).toBe("휴가");
    expect(c.description).toBeNull();
    expect(c.masked).toBe(true);
  });

  it("본인 휴가 → 상세 노출·masked false", () => {
    const c = maskEvent(ev({ userId: "u1", title: "휴가", description: "병원" }), ctx({ userId: "u1" }));
    expect(c.description).toBe("병원");
    expect(c.masked).toBe(false);
  });

  it("calendar.admin:view 보유 → 타인도 상세", () => {
    const c = maskEvent(ev({ userId: "u9" }), ctx({ userId: "u1", permissionKeys: new Set(["calendar.admin:view"]) }));
    expect(c.description).toBe("가족 여행");
    expect(c.masked).toBe(false);
  });

  it("isOwner(시스템 OWNER) → 상세", () => {
    const c = maskEvent(ev({ userId: "u9" }), ctx({ userId: "u1", isOwner: true }));
    expect(c.masked).toBe(false);
  });

  it("공휴일은 민감하지 않음 → 마스킹 안 함", () => {
    const c = maskEvent(ev({ kind: "HOLIDAY", title: "신정", description: null, userId: null }), ctx({ userId: "u1" }));
    expect(c.title).toBe("신정");
    expect(c.masked).toBe(false);
  });

  it("업무 일정도 마스킹 안 함", () => {
    const c = maskEvent(ev({ kind: "WORKFLOW_TASK", title: "주간보고", description: null, userId: null }), ctx({ userId: "u1" }));
    expect(c.masked).toBe(false);
    expect(c.title).toBe("주간보고");
  });

  it("Date는 ISO 문자열로 직렬화", () => {
    const c = maskEvent(ev({}), ctx({ userId: "u1" }));
    expect(c.start).toBe("2026-06-10T00:00:00.000Z");
    expect(c.end).toBe("2026-06-11T00:00:00.000Z");
  });

  it("tentative 플래그는 그대로 통과(가시성/접기 판단은 feed)", () => {
    expect(maskEvent(ev({ tentative: true }), ctx({ userId: "u1" })).tentative).toBe(true);
    expect(maskEvent(ev({ tentative: false }), ctx({ userId: "u1" })).tentative).toBe(false);
  });
});
