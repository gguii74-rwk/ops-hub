import { describe, it, expect } from "vitest";
import { kindClass, statusOverlay } from "@/modules/calendar/ui/kind-styles";

describe("kindClass", () => {
  it("등록 kind는 intensity별로 다른 클래스(soft≠bold)", () => {
    const soft = kindClass("WORKFLOW_TASK", "soft");
    const bold = kindClass("WORKFLOW_TASK", "bold");
    expect(soft).toContain("orange-100");
    expect(bold).toContain("orange-500");
    expect(soft).not.toBe(bold);
  });

  it("연차 전용 leaveType도 색 매핑(ANNUAL=blue, HALF=emerald, QUARTER=violet)", () => {
    expect(kindClass("ANNUAL", "soft")).toContain("blue");
    expect(kindClass("HALF", "soft")).toContain("emerald");
    expect(kindClass("QUARTER", "soft")).toContain("violet");
  });

  it("변형 A: soft 라이트모드 글자색 700(ANNUAL/HALF/QUARTER/HOLIDAY)", () => {
    expect(kindClass("ANNUAL", "soft")).toContain("text-blue-700");
    expect(kindClass("HALF", "soft")).toContain("text-emerald-700");
    expect(kindClass("QUARTER", "soft")).toContain("text-violet-700");
    expect(kindClass("HOLIDAY", "soft")).toContain("text-rose-700");
    // 배경·ring은 유지
    expect(kindClass("ANNUAL", "soft")).toContain("bg-blue-100");
    expect(kindClass("HOLIDAY", "soft")).toContain("bg-rose-100");
    // 950(이전 톤)은 더 이상 없음
    expect(kindClass("ANNUAL", "soft")).not.toContain("text-blue-950");
    expect(kindClass("HOLIDAY", "soft")).not.toContain("text-rose-950");
  });

  it("미등록 kind는 중립 폴백(빈 문자열 아님)", () => {
    const cls = kindClass("UNKNOWN_KIND", "soft");
    expect(cls.length).toBeGreaterThan(0);
    expect(cls).not.toContain("orange");
  });
});

describe("statusOverlay (색과 직교, 형태만)", () => {
  it("PENDING = 점선 테두리 + 대기색(주황 배경·진한 노랑 점선)", () => {
    const cls = statusOverlay("PENDING");
    expect(cls).toContain("border-dashed");
    expect(cls).toContain("bg-amber-100"); // 주황 배경
    expect(cls).toContain("border-yellow-500"); // 진한 노랑 점선
  });
  it("REJECTED/CANCELLED = 취소선 + 흐림", () => {
    expect(statusOverlay("REJECTED")).toContain("line-through");
    expect(statusOverlay("CANCELLED")).toContain("line-through");
    expect(statusOverlay("CANCELLED")).toContain("opacity");
  });
  it("APPROVED·null·undefined = 기본(빈 문자열)", () => {
    expect(statusOverlay("APPROVED")).toBe("");
    expect(statusOverlay(null)).toBe("");
    expect(statusOverlay()).toBe("");
  });
});
