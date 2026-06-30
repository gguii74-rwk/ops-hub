import { describe, it, expect } from "vitest";
import { billingConfigSchema, billingConfigUpdateSchema } from "@/modules/workflows/validations";

const base = {
  year: 2026, projectName: "안전신문고 시스템 유지관리 사업", contractNumber: "R25TA0125611600",
  contractAmount: 1675080000, monthlyAmount: 139590000,
  contractAmountKor: "금일십육억칠천오백팔만원정", monthlyAmountKor: "금일억삼천구백오십구만원정",
};

describe("billingConfigSchema (F3·J4 BigInt 경계)", () => {
  it("정상 입력 → 금액이 bigint로 coerce", () => {
    const r = billingConfigSchema.parse(base);
    expect(typeof r.contractAmount).toBe("bigint");
    expect(r.contractAmount).toBe(1675080000n);
    expect(r.monthlyAmount).toBe(139590000n);
  });
  it("문자열 금액도 coerce", () => {
    const r = billingConfigSchema.parse({ ...base, contractAmount: "1675080000", monthlyAmount: "139590000" });
    expect(r.contractAmount).toBe(1675080000n);
  });
  it("음수 금액 거부", () => {
    expect(() => billingConfigSchema.parse({ ...base, contractAmount: -1 })).toThrow();
    expect(() => billingConfigSchema.parse({ ...base, monthlyAmount: 0 })).toThrow();
  });
  it("contractAmount > MAX_SAFE_INTEGER 거부(F3)", () => {
    expect(() => billingConfigSchema.parse({ ...base, contractAmount: BigInt(Number.MAX_SAFE_INTEGER) + 1n })).toThrow();
  });
  it("monthlyAmount > MAX_SAFE_INTEGER/12 거부(J4 — 12회차 누계 안전)", () => {
    const overMonthly = BigInt(Number.MAX_SAFE_INTEGER) / 12n + 1n;
    expect(() => billingConfigSchema.parse({ ...base, monthlyAmount: overMonthly })).toThrow();
  });
  it("연도 범위 밖 거부", () => {
    expect(() => billingConfigSchema.parse({ ...base, year: 2019 })).toThrow();
    expect(() => billingConfigSchema.parse({ ...base, year: 2101 })).toThrow();
  });
  it("빈 문자열 필드 거부", () => {
    expect(() => billingConfigSchema.parse({ ...base, projectName: "" })).toThrow();
    expect(() => billingConfigSchema.parse({ ...base, contractAmountKor: "" })).toThrow();
  });
  it("update 스키마는 year omit + partial", () => {
    const r = billingConfigUpdateSchema.parse({ monthlyAmount: 200000000 });
    expect(r.monthlyAmount).toBe(200000000n);
    expect("year" in r).toBe(false);
  });
});
