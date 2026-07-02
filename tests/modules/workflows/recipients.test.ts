import { describe, it, expect } from "vitest";
import { parseDefaultRecipients, normalizeStoredEmails } from "@/modules/workflows/recipients";

describe("parseDefaultRecipients (D3 구조)", () => {
  it("null·flat 배열(legacy)·원시값 → null (새 구조로 오독하지 않음)", () => {
    expect(parseDefaultRecipients(null)).toBeNull();
    expect(parseDefaultRecipients(["a@x.com"])).toBeNull();
    expect(parseDefaultRecipients("a@x.com")).toBeNull();
    expect(parseDefaultRecipients(7)).toBeNull();
  });
  it("단계별 {to,cc,bcc} 채택, 누락 필드는 []", () => {
    expect(parseDefaultRecipients({ "1": { to: ["a@x.com"], cc: ["b@x.com"] } }))
      .toEqual({ "1": { to: ["a@x.com"], cc: ["b@x.com"], bcc: [] } });
  });
  it("비객체 step 값은 skip, 비문자 항목은 걸러낸다", () => {
    expect(parseDefaultRecipients({ "1": ["a@x.com"], "2": { to: ["a@x.com", 3] } }))
      .toEqual({ "2": { to: ["a@x.com"], cc: [], bcc: [] } });
  });
  it("빈 객체 → 빈 맵(널 아님)", () => {
    expect(parseDefaultRecipients({})).toEqual({});
  });
});

describe("normalizeStoredEmails (§3 세트 저장 정규화)", () => {
  it("trim·소문자·빈 제거·순서보존 dedup", () => {
    expect(normalizeStoredEmails([" A@X.com ", "a@x.com", "b@x.com", ""]))
      .toEqual(["a@x.com", "b@x.com"]);
  });
  it("빈 입력 → []", () => {
    expect(normalizeStoredEmails([])).toEqual([]);
  });
});
