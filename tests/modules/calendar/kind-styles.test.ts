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

// 신규 workflow kind 5종이 중립 폴백이 아닌 고유 색을 가져야 함(D7).
const WORKFLOW_KINDS = ["BILLING", "NOTIFICATION_BILLING", "WEEKLY_REPORT", "WEEKLY_REPORT_CLIENT", "MONTHLY_REPORT_CLIENT"];
const NEUTRAL_SOFT = "bg-accent text-accent-foreground ring-1 ring-border";

describe("kindClass — workflow kind 색(D7)", () => {
  it("5 workflow kind 모두 soft/bold가 중립 폴백이 아니다", () => {
    for (const k of WORKFLOW_KINDS) {
      expect(kindClass(k, "soft")).not.toBe(NEUTRAL_SOFT);
      expect(kindClass(k, "bold")).not.toBe(NEUTRAL_SOFT);
    }
  });

  it("각 kind 색이 서로 다르다(식별성)", () => {
    const softs = WORKFLOW_KINDS.map((k) => kindClass(k, "soft"));
    expect(new Set(softs).size).toBe(WORKFLOW_KINDS.length);
  });

  it("D7 팔레트 계열 — 대금청구=주황·알림톡청구=청록·주간(본부)=인디고·주간(고객사)=보라·월간(고객사)=핑크", () => {
    expect(kindClass("BILLING", "soft")).toContain("orange");
    expect(kindClass("NOTIFICATION_BILLING", "soft")).toContain("cyan");
    expect(kindClass("WEEKLY_REPORT", "soft")).toContain("indigo");
    expect(kindClass("WEEKLY_REPORT_CLIENT", "soft")).toContain("violet");
    expect(kindClass("MONTHLY_REPORT_CLIENT", "soft")).toContain("pink");
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
