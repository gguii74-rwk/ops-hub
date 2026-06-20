import { describe, it, expect } from "vitest";
import {
  buildRequestNotification, buildApprovedNotification, buildRejectedNotification, buildAdminCreatedNotification,
  type MailReqLike,
} from "@/modules/leave/mail-templates";

const baseReq: MailReqLike = {
  leaveType: "ANNUAL",
  leaveSubType: null,
  quarterStartTime: null,
  startDate: new Date("2026-08-14T00:00:00Z"),
  endDate: new Date("2026-08-15T00:00:00Z"),
  reason: null,
};

// 본문 html에 raw '<' '>' 페이로드가 남지 않고 엔티티로 인코딩됐는지 검사하는 공용 단언.
// 보안 속성: 페이로드의 '<'/'>'가 살아남아 실제 태그를 형성하면 안 된다. 'onerror' 같은 단어는
// 위험 문자가 아니므로(엔티티 내부에 텍스트로 남아도 무해) angle-bracket 생존 여부로만 판정한다.
function assertNoRawHtmlInjection(html: string, payload: string) {
  // 페이로드가 만들려던 실제 태그가 형성되면 안 됨(raw '<tag' 미생존)
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<a href");
  expect(html).not.toContain("<script");
  // 원본 페이로드 문자열(raw '<'/'>' 포함) 그대로는 없음
  expect(html).not.toContain(payload);
  // 인코딩 흔적이 있어야 함(페이로드의 angle bracket이 엔티티로 변환됨)
  expect(html).toContain("&lt;");
  expect(html).toContain("&gt;");
}

const XSS = '<img src=x onerror=alert(1)>';

describe("buildRequestNotification — 동적 텍스트 이스케이프", () => {
  it("applicantName·reason에 HTML 페이로드를 넣어도 본문에서 이스케이프된다", () => {
    const { html } = buildRequestNotification(`악의<script>name`, { ...baseReq, reason: XSS });
    assertNoRawHtmlInjection(html, XSS);
    expect(html).toContain("&lt;script&gt;"); // applicantName도 esc
  });
  it('reason의 " 와 \' 도 인코딩된다', () => {
    const { html } = buildRequestNotification("name", { ...baseReq, reason: `say "hi" it's` });
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
    expect(html).not.toContain('say "hi"');
  });
});

describe("buildApprovedNotification — 동적 텍스트 이스케이프", () => {
  it("reason 페이로드가 본문에서 이스케이프된다", () => {
    const { html } = buildApprovedNotification({ ...baseReq, reason: XSS });
    assertNoRawHtmlInjection(html, XSS);
  });
});

describe("buildRejectedNotification — 동적 텍스트 이스케이프", () => {
  it("rejectionReason 페이로드가 본문에서 이스케이프된다", () => {
    const { html } = buildRejectedNotification({ ...baseReq, reason: null }, '<a href="evil">반려</a>');
    expect(html).not.toContain('<a href="evil"');
    expect(html).toContain("&lt;a href=&quot;evil&quot;&gt;");
  });
  it("reason과 rejectionReason 둘 다 이스케이프", () => {
    const { html } = buildRejectedNotification({ ...baseReq, reason: XSS }, XSS);
    assertNoRawHtmlInjection(html, XSS);
  });
});

describe("buildAdminCreatedNotification — 동적 텍스트 이스케이프", () => {
  it("reason 페이로드가 본문에서 이스케이프된다", () => {
    const { html } = buildAdminCreatedNotification({ ...baseReq, reason: XSS });
    assertNoRawHtmlInjection(html, XSS);
  });
});

describe("정상 표시 — 안전한 입력은 그대로 표시", () => {
  it("기간/유형이 본문에 표시되고 subject는 HTML-escape 대상 아님", () => {
    const { subject, html } = buildRequestNotification("홍길동", { ...baseReq, reason: "개인 사정" });
    expect(subject).toContain("홍길동");
    expect(subject).toContain("연차");
    expect(html).toContain("2026-08-14 ~ 2026-08-15");
    expect(html).toContain("개인 사정");
  });
});
