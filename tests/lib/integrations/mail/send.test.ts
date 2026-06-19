import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendMail, setMailTransportForTests, type MailTransport } from "@/lib/integrations/mail";

let sent: any[] = [];
const fake: MailTransport = {
  async sendMail(opts) {
    sent.push(opts);
    return { messageId: "msg-123" };
  },
};

beforeEach(() => {
  sent = [];
  setMailTransportForTests(fake);
});
afterEach(() => setMailTransportForTests(null));

describe("sendMail", () => {
  it("주입된 transport로 발송하고 providerMessageId를 messageId에서 가져온다", async () => {
    const out = await sendMail({ to: ["a@x.com"], subject: "제목", html: "<p>본문</p>" });
    expect(out).toEqual({ providerMessageId: "msg-123" });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("제목");
    expect(sent[0].to).toBe("a@x.com");
  });

  it("수신자를 정규화(trim·중복 제거)해 콤마로 결합", async () => {
    await sendMail({ to: [" a@x.com ", "A@x.com", "b@x.com"], subject: "s", html: "<p>h</p>" });
    expect(sent[0].to).toBe("a@x.com, b@x.com");
  });

  it("HTML 서명을 본문 뒤에 덧붙인다", async () => {
    await sendMail({ to: ["a@x.com"], subject: "s", html: "<p>본문</p>" });
    expect(sent[0].html.startsWith("<p>본문</p>")).toBe(true);
    expect(sent[0].html).toContain("자동 발송");
  });

  it("messageId가 없으면 providerMessageId=null", async () => {
    setMailTransportForTests({ async sendMail() { return {}; } });
    expect(await sendMail({ to: ["a@x.com"], subject: "s", html: "<p>h</p>" })).toEqual({ providerMessageId: null });
  });

  it("수신자가 비면 에러", async () => {
    await expect(sendMail({ to: ["  "], subject: "s", html: "<p>h</p>" })).rejects.toThrow();
  });

  it("transport 미주입 + SMTP_HOST 미설정 → 에러(조용한 성공 금지)", async () => {
    setMailTransportForTests(null);
    const prev = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      await expect(sendMail({ to: ["a@x.com"], subject: "s", html: "<p>h</p>" })).rejects.toThrow(/SMTP_HOST/);
    } finally {
      if (prev !== undefined) process.env.SMTP_HOST = prev;
    }
  });
});
