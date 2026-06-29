import { describe, it, expect } from "vitest";
import { escapeXml, formatAmount, formatAmountBig, fillEmptyCell, clearCellText, fillGisungTable } from "@/modules/workflows/billing/hwpx-helpers";

describe("escapeXml (D9)", () => {
  it("& < > \" ' 를 엔티티로", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
  it("& 를 먼저 치환(이중 이스케이프 방지)", () => {
    expect(escapeXml("<")).toBe("&lt;");
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });
});

describe("formatAmount / formatAmountBig", () => {
  it("number 콤마 포맷", () => { expect(formatAmount(139590000)).toBe("139,590,000"); });
  it("bigint 콤마 포맷(누계 J4)", () => { expect(formatAmountBig(418770000n)).toBe("418,770,000"); });
});

const cell = (col: number, row: number) =>
  `<hp:tc><hp:subList><hp:p><hp:run charPrIDRef="6"/></hp:p></hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/></hp:tc>`;

describe("fillEmptyCell / clearCellText", () => {
  it("빈 self-closing run을 텍스트 run으로 치환", () => {
    const out = fillEmptyCell(cell(6, 7), 6, 7, "418,770,000");
    expect(out).toContain('<hp:run charPrIDRef="6"><hp:t>418,770,000</hp:t></hp:run>');
  });
  it("marker 없으면 원본 유지", () => {
    expect(fillEmptyCell(cell(1, 5), 9, 9, "x")).toBe(cell(1, 5));
  });
  it("clearCellText: <hp:t> 비움", () => {
    const xml = `<hp:tc><hp:subList><hp:p><hp:run><hp:t>old</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="2" rowAddr="6"/></hp:tc>`;
    expect(clearCellText(xml, 2, 6)).toContain("<hp:t></hp:t>");
  });
});

describe("fillGisungTable (행·열·누계 BigInt)", () => {
  it("round=1이면 2회차 행(rowAddr=6) 텍스트 clear, 1회차 날짜 치환", () => {
    const xml = "02월 10일" + cell(1, 6) + cell(2, 6) + cell(4, 6) + cell(6, 6);
    const out = fillGisungTable(xml, "15", 1, "139,590,000", 139590000n, {});
    expect(out).toContain("02월 15일"); // 1회차 제출일 치환(폴백 DD=15)
  });
  it("round=3이면 3회차 누계 = monthlyAmount*3을 BigInt로(rowAddr=7)", () => {
    const xml = "02월 10일03월 10일" + cell(1, 7) + cell(2, 7) + cell(4, 7) + cell(6, 7);
    const out = fillGisungTable(xml, "10", 3, "139,590,000", 139590000n, {});
    expect(out).toContain("<hp:t>418,770,000</hp:t>"); // 139,590,000 * 3
  });
});

describe("fillGisungTable — roundDateMap KST 변환 경로", () => {
  it("roundDateMap[1]의 submitDate에서 KST DD를 추출(일반 케이스)", () => {
    // 2026-03-23T09:00:00Z = 2026-03-23 18:00 KST → KST day = 23
    const xml = "02월 10일";
    const submitDate = new Date("2026-03-23T09:00:00Z");
    const out = fillGisungTable(xml, "10", 1, "139,590,000", 139590000n, { 1: submitDate });
    expect(out).toContain("02월 23일"); // KST day = 23
  });

  it("KST 경계: UTC day 22이지만 KST day 23인 submitDate → 23을 사용해야 함(TZ 회귀 방지)", () => {
    // 2026-03-22T15:30:00Z = 2026-03-23 00:30 KST → KST day = 23, UTC day = 22
    const xml = "02월 10일";
    const submitDate = new Date("2026-03-22T15:30:00Z");
    const out = fillGisungTable(xml, "10", 1, "139,590,000", 139590000n, { 1: submitDate });
    expect(out).toContain("02월 23일"); // KST day(23), UTC day(22) 아님
    expect(out).not.toContain("02월 22일");
  });

  it("round=2, roundDateMap[2] 있으면 3월 날짜도 KST DD로 치환", () => {
    // 2026-04-22T15:00:00Z = 2026-04-23 00:00 KST → KST day = 23
    const xml = "02월 10일03월 10일";
    const d1 = new Date("2026-03-23T09:00:00Z"); // KST day 23
    const d2 = new Date("2026-04-22T15:00:00Z"); // KST day 23 (경계)
    const out = fillGisungTable(xml, "10", 2, "139,590,000", 139590000n, { 1: d1, 2: d2 });
    expect(out).toContain("02월 23일");
    expect(out).toContain("03월 23일");
  });
});
