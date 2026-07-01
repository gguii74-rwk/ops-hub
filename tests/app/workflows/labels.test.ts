import { describe, it, expect } from "vitest";
import { KIND_LABEL, WORKFLOW_KIND_ORDER } from "@/app/(app)/workflows/labels";
import { KIND_RESOURCE } from "@/modules/workflows/policy";

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

  // F1 가드: WORKFLOW_KIND_ORDER는 완전매핑 Record(KIND_RESOURCE) 파생이 아닌 유일한 손수유지 WorkflowKind[]다.
  // 필터·범례·생성 드롭다운 순서를 구동하므로, 신규 kind가 enum/KIND_RESOURCE에만 추가되고 여기서 누락되면
  // 그 세 화면에서 조용히 빠진다(typecheck 미보호). 이 테스트가 그 drift를 잡는다.
  it("KIND_RESOURCE(완전매핑 Record)의 모든 kind를 빠짐없이 포함한다", () => {
    expect([...WORKFLOW_KIND_ORDER].sort()).toEqual(Object.keys(KIND_RESOURCE).sort());
  });
});
