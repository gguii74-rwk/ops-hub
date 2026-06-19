import { describe, it, expect } from "vitest";
import { applyDedup } from "@/modules/calendar/dedup";
import type { RawEvent } from "@/modules/calendar/types";

function ev(p: Partial<RawEvent>): RawEvent {
  return {
    id: "x", kind: "EXTERNAL_EVENT", title: "t", description: null,
    start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z"),
    allDay: true, userId: null, sourceKey: "google-team", externalId: null,
    dedupStatus: "UNIQUE", duplicateOfId: null, tentative: false, ...p,
  };
}

describe("applyDedup", () => {
  it("외부 all-day + 휴가 키워드 → EXTERNAL_VACATION 재분류", () => {
    const out = applyDedup([ev({ id: "e1", title: "여름 휴가", allDay: true })]);
    expect(out[0].kind).toBe("EXTERNAL_VACATION");
    expect(out[0].dedupStatus).toBe("UNIQUE"); // userId 없으면 dedup은 안 함
  });

  it("키워드 있어도 all-day 아니면 재분류 안 함", () => {
    const out = applyDedup([ev({ id: "e2", title: "휴가 인수인계 회의", allDay: false })]);
    expect(out[0].kind).toBe("EXTERNAL_EVENT");
  });

  it("키워드 없으면 그대로", () => {
    const out = applyDedup([ev({ id: "e3", title: "팀 미팅", allDay: true })]);
    expect(out[0].kind).toBe("EXTERNAL_EVENT");
  });

  it("userId 매핑된 외부 휴가가 내부 APPROVED 휴가와 겹침 → DUPLICATE_OF_INTERNAL(비파괴)", () => {
    const internal = ev({ id: "leave:l1", kind: "INTERNAL_LEAVE", title: "휴가", userId: "u9", sourceKey: "internalLeave", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-12T00:00:00Z") });
    const external = ev({ id: "google-team:g1", title: "연차", allDay: true, userId: "u9", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z") });
    const out = applyDedup([internal, external]);
    expect(out).toHaveLength(2); // 삭제 안 함
    const ext = out.find((e) => e.id === "google-team:g1")!;
    expect(ext.kind).toBe("EXTERNAL_VACATION");
    expect(ext.dedupStatus).toBe("DUPLICATE_OF_INTERNAL");
    expect(ext.duplicateOfId).toBe("leave:l1");
    // 내부 이벤트는 불변
    expect(out.find((e) => e.id === "leave:l1")!.dedupStatus).toBe("UNIQUE");
  });

  it("userId 다르면 dedup 안 함", () => {
    const internal = ev({ id: "leave:l1", kind: "INTERNAL_LEAVE", userId: "u9", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-12T00:00:00Z") });
    const external = ev({ id: "g1", title: "휴가", allDay: true, userId: "u8", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z") });
    const out = applyDedup([internal, external]);
    expect(out.find((e) => e.id === "g1")!.dedupStatus).toBe("UNIQUE");
  });

  it("tentative(PENDING) 내부 휴가는 dedup 앵커가 아님 → 외부 휴가 UNIQUE 유지", () => {
    const pending = ev({ id: "leave:l2", kind: "INTERNAL_LEAVE", title: "휴가", userId: "u9", sourceKey: "internalLeave", tentative: true, start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-12T00:00:00Z") });
    const external = ev({ id: "google-team:g2", title: "연차", allDay: true, userId: "u9", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z") });
    const out = applyDedup([pending, external]);
    const extOut = out.find((e) => e.id === "google-team:g2")!;
    expect(extOut.kind).toBe("EXTERNAL_VACATION"); // 키워드 재분류는 됨
    expect(extOut.dedupStatus).toBe("UNIQUE"); // 단 미승인(PENDING)과는 dedup 안 함
  });
});
