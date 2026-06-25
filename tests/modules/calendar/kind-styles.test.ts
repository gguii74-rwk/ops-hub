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

  it("연차 전용 leaveType도 색 매핑(HALF=teal, QUARTER=cyan, ANNUAL=emerald)", () => {
    expect(kindClass("HALF", "soft")).toContain("teal");
    expect(kindClass("QUARTER", "soft")).toContain("cyan");
    expect(kindClass("ANNUAL", "soft")).toContain("emerald");
  });

  it("미등록 kind는 중립 폴백(빈 문자열 아님)", () => {
    const cls = kindClass("UNKNOWN_KIND", "soft");
    expect(cls.length).toBeGreaterThan(0);
    expect(cls).not.toContain("orange");
  });
});

describe("statusOverlay (색과 직교, 형태만)", () => {
  it("PENDING = 점선 테두리", () => {
    expect(statusOverlay("PENDING")).toContain("border-dashed");
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
