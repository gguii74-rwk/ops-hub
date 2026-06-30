import { describe, it, expect } from "vitest";
import { buildSubject, buildBody, plainToHtml } from "@/app/(app)/workflows/mail-templates";

const ctx = (iso: string, projectName = "테스트사업") => ({ scheduledAt: new Date(iso), projectName });

describe("buildSubject", () => {
  it("step1: 전월(round)·projectYear·projectName 치환(KST)", () => {
    // 2026-02-10 KST(=2026-02-09T15:00Z): 전월=1월, projectYear=2026
    expect(buildSubject(1, ctx("2026-02-09T15:00:00.000Z"))).toBe("2026년 테스트사업 1월 대금 청구의 건");
  });
  it("step2: 서류 요청의 건", () => {
    expect(buildSubject(2, ctx("2026-02-09T15:00:00.000Z"))).toBe("2026년 테스트사업 1월 대금 청구 서류 요청의 건");
  });
  it("KST 월 경계: 3/1 00:00 KST면 전월=2월(서버 TZ 무관, D4)", () => {
    // 2026-03-01T00:00 KST = 2026-02-28T15:00Z. 로컬 UTC 메서드면 2월 28일로 읽어 회차 오산.
    expect(buildSubject(1, ctx("2026-02-28T15:00:00.000Z"))).toBe("2026년 테스트사업 2월 대금 청구의 건");
  });
  it("1월 경계: 1월분 청구는 전년 12월·전년 projectYear", () => {
    expect(buildSubject(1, ctx("2026-01-15T00:00:00.000Z"))).toBe("2025년 테스트사업 12월 대금 청구의 건");
  });
});

describe("buildBody", () => {
  it("step1: 공문 발송일(billingM/billingD)·KST 요일·전월 청구 문구", () => {
    const body = buildBody(1, ctx("2026-02-09T15:00:00.000Z")); // KST 2026-02-10(화)
    expect(body).toContain("2026년 테스트사업 1월 대금 청구 관련 서류보내드리니");
    expect(body).toContain("공문 발송일은 2월 10일로 작성하였습니다.");
    expect(body).toContain("2월 10일(화)에 원본 서류 전달 드리겠습니다.");
  });
  it("step2: projectName + 완납증명서/4대보험 문구", () => {
    const body = buildBody(2, ctx("2026-02-09T15:00:00.000Z"));
    expect(body).toContain("테스트사업 대금 청구 관련하여 서류 요청 드립니다.");
    expect(body).toContain("2월 10일(화) 발행한 국세/지방세 완납증명서, 4대보험 완납증명서 스캔본(PDF)");
  });
});

describe("plainToHtml", () => {
  it("줄은 <p>, 빈 줄은 <br>", () => {
    expect(plainToHtml("a\n\nb")).toBe("<p>a</p>\n<br>\n<p>b</p>");
  });
  it("HTML 특수문자·태그를 escape(외부 발송 본문 주입 차단, F-A1)", () => {
    expect(plainToHtml("<img src=x onerror=alert(1)>")).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
    expect(plainToHtml("A&B <b>회사</b>")).toBe("<p>A&amp;B &lt;b&gt;회사&lt;/b&gt;</p>");
  });
});
