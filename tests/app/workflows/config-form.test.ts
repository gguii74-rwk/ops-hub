import { describe, it, expect } from "vitest";
import { validateConfigForm, formToConfigPayload, emptyConfigForm, MAX_MONTHLY } from "@/app/(app)/workflows/billing/settings/config-form";

const base = { ...emptyConfigForm, year: 2026, projectName: "P", contractNumber: "C-1",
  contractAmount: "1200", monthlyAmount: "100", contractAmountKor: "천이백", monthlyAmountKor: "백" };

describe("validateConfigForm", () => {
  it("정상 입력 → null", () => { expect(validateConfigForm(base)).toBeNull(); });
  it("사업명 누락 → 오류", () => { expect(validateConfigForm({ ...base, projectName: "  " })).toMatch(/사업명/); });
  it("금액 0/음수/소수 → 오류", () => {
    expect(validateConfigForm({ ...base, contractAmount: "0" })).toMatch(/총 계약금액/);
    expect(validateConfigForm({ ...base, monthlyAmount: "-5" })).toMatch(/월 청구금액/);
    expect(validateConfigForm({ ...base, contractAmount: "12.5" })).toMatch(/총 계약금액/);
  });
  it("월 청구액 상한(MAX_SAFE/12) 초과 → 오류", () => {
    expect(validateConfigForm({ ...base, monthlyAmount: String(MAX_MONTHLY + 1) })).toMatch(/월 청구금액/);
  });
  it("한글 금액 누락 → 오류", () => { expect(validateConfigForm({ ...base, contractAmountKor: "" })).toMatch(/한글/); });
});

describe("formToConfigPayload", () => {
  it("금액은 Number, 문자열은 trim", () => {
    expect(formToConfigPayload({ ...base, projectName: " P " })).toEqual({
      year: 2026, projectName: "P", contractNumber: "C-1",
      contractAmount: 1200, monthlyAmount: 100, contractAmountKor: "천이백", monthlyAmountKor: "백",
    });
  });
});
