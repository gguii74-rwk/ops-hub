import { describe, it, expect } from "vitest";
import {
  TRANSITIONS,
  KIND_RESOURCE,
  ACTION_FOR_STATUS,
  STAMP_FOR_STATUS,
  sendStepsForKind,
  mailRecipientKinds,
} from "@/modules/workflows/policy";
import { ConflictError } from "@/modules/workflows/types";

describe("TRANSITIONS (fail-closed)", () => {
  it("5개 kind를 모두 정의한다(신규 client 2종 포함)", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(
      ["BILLING", "MONTHLY_REPORT_CLIENT", "NOTIFICATION_BILLING", "WEEKLY_REPORT", "WEEKLY_REPORT_CLIENT"],
    );
  });

  it("WEEKLY_REPORT은 PENDING→GENERATED/CANCELLED만 허용(직접 SENT 불가)", () => {
    expect(TRANSITIONS.WEEKLY_REPORT.PENDING).toEqual(["GENERATED", "CANCELLED"]);
    expect(TRANSITIONS.WEEKLY_REPORT.PENDING).not.toContain("SENT");
  });

  it("모든 kind는 PENDING에서 CANCELLED로 갈 수 있다", () => {
    for (const kind of Object.keys(TRANSITIONS) as Array<keyof typeof TRANSITIONS>) {
      expect(TRANSITIONS[kind].PENDING).toContain("CANCELLED");
    }
  });

  it("NOTIFICATION_BILLING만 GENERATED→REVIEWED를 허용한다", () => {
    expect(TRANSITIONS.NOTIFICATION_BILLING.GENERATED).toContain("REVIEWED");
    expect(TRANSITIONS.WEEKLY_REPORT.GENERATED ?? []).not.toContain("REVIEWED");
  });

  it("BILLING은 SENT→HQ_REQUESTED→FINAL_SENT 사슬을 가진다", () => {
    expect(TRANSITIONS.BILLING.SENT).toEqual(["HQ_REQUESTED"]);
    expect(TRANSITIONS.BILLING.HQ_REQUESTED).toEqual(["FINAL_SENT"]);
  });

  it("신규 client 2종은 WEEKLY_REPORT 골격(PENDING→GENERATED/CANCELLED, GENERATED→SENT/CANCELLED)", () => {
    for (const kind of ["WEEKLY_REPORT_CLIENT", "MONTHLY_REPORT_CLIENT"] as const) {
      expect(TRANSITIONS[kind].PENDING).toEqual(["GENERATED", "CANCELLED"]);
      expect(TRANSITIONS[kind].GENERATED).toEqual(["SENT", "CANCELLED"]);
    }
  });
});

describe("권한·stamp 매핑", () => {
  it("KIND_RESOURCE", () => {
    expect(KIND_RESOURCE.WEEKLY_REPORT).toBe("workflows.weekly");
    expect(KIND_RESOURCE.BILLING).toBe("workflows.billing");
    expect(KIND_RESOURCE.NOTIFICATION_BILLING).toBe("workflows.notification");
    expect(KIND_RESOURCE.WEEKLY_REPORT_CLIENT).toBe("workflows.weeklyClient");
    expect(KIND_RESOURCE.MONTHLY_REPORT_CLIENT).toBe("workflows.monthlyClient");
  });

  it("ACTION_FOR_STATUS", () => {
    expect(ACTION_FOR_STATUS.GENERATED).toBe("generate");
    expect(ACTION_FOR_STATUS.REVIEWED).toBe("review");
    expect(ACTION_FOR_STATUS.SENT).toBe("send");
    expect(ACTION_FOR_STATUS.HQ_REQUESTED).toBe("send");
    expect(ACTION_FOR_STATUS.FINAL_SENT).toBe("send");
    expect(ACTION_FOR_STATUS.CANCELLED).toBe("view");
  });

  it("STAMP_FOR_STATUS는 GENERATED/REVIEWED/SENT만 컬럼을 매핑", () => {
    expect(STAMP_FOR_STATUS.GENERATED).toBe("generatedAt");
    expect(STAMP_FOR_STATUS.REVIEWED).toBe("reviewedAt");
    expect(STAMP_FOR_STATUS.SENT).toBe("sentAt");
    expect(STAMP_FOR_STATUS.HQ_REQUESTED).toBeUndefined();
    expect(STAMP_FOR_STATUS.CANCELLED).toBeUndefined();
  });
});

describe("ConflictError", () => {
  it("name이 ConflictError이고 Error를 상속한다", () => {
    const e = new ConflictError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ConflictError");
  });
});

describe("sendStepsForKind·mailRecipientKinds (D7 — SEND_STEP_TRANSITION 파생 단일 출처)", () => {
  it("BILLING의 발송 step은 ['1','2']", () => {
    expect(sendStepsForKind("BILLING")).toEqual(["1", "2"]);
  });
  it("발송 단계가 정의되지 않은 kind는 []", () => {
    expect(sendStepsForKind("WEEKLY_REPORT")).toEqual([]);
    expect(sendStepsForKind("WEEKLY_REPORT_CLIENT")).toEqual([]);
  });
  it("mailRecipientKinds는 현재 BILLING뿐 — 향후 kind에 step이 생기면 자동 확장", () => {
    expect(mailRecipientKinds()).toEqual(["BILLING"]);
  });
});
