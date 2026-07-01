import { describe, it, expect } from "vitest";
import { KIND_LABEL, WORKFLOW_KIND_ORDER } from "@/app/(app)/workflows/labels";

describe("KIND_LABEL — 5종 사용자 명칭 통일(SC-5)", () => {
  it("5 kind 라벨", () => {
    expect(KIND_LABEL.BILLING).toBe("대금청구");
    expect(KIND_LABEL.NOTIFICATION_BILLING).toBe("알림톡청구");
    expect(KIND_LABEL.WEEKLY_REPORT).toBe("주간보고(본부)");
    expect(KIND_LABEL.WEEKLY_REPORT_CLIENT).toBe("주간보고(고객사)");
    expect(KIND_LABEL.MONTHLY_REPORT_CLIENT).toBe("월간보고(고객사)");
  });
});

describe("WORKFLOW_KIND_ORDER — 필터·드롭다운 순서(D6/D10)", () => {
  it("5종·enum 값·고정 순서", () => {
    expect(WORKFLOW_KIND_ORDER).toEqual([
      "BILLING", "NOTIFICATION_BILLING", "WEEKLY_REPORT", "WEEKLY_REPORT_CLIENT", "MONTHLY_REPORT_CLIENT",
    ]);
  });
  it("모든 순서 항목이 KIND_LABEL을 가진다", () => {
    for (const k of WORKFLOW_KIND_ORDER) expect(KIND_LABEL[k]).toBeTruthy();
  });
});
