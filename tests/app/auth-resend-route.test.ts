import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  enforceResendCooldown: vi.fn(), refreshVerifyToken: vi.fn(),
  triggerLeaveMailDrain: vi.fn(), generateVerifyToken: vi.fn(() => "plain"), hashToken: vi.fn((t: string) => `hash:${t}`),
  buildVerifyLink: vi.fn((_req: Request, token: string) => `https://ops.example.com/verify-email?token=${token}`),
  buildVerifyEmailMail: vi.fn((link: string) => ({ subject: "verify", bodyHtml: `<a href="${link}">link</a>` })),
}));
vi.mock("@/modules/admin/users/rate-limit", () => ({ enforceResendCooldown: m.enforceResendCooldown, VERIFY_TOKEN_TTL_MS: 7 * 24 * 60 * 60 * 1000 }));
vi.mock("@/modules/admin/users/repositories", () => ({ refreshVerifyToken: m.refreshVerifyToken }));
vi.mock("@/modules/leave/services/mail", () => ({ triggerLeaveMailDrain: m.triggerLeaveMailDrain }));
vi.mock("@/modules/admin/users/token", () => ({ generateVerifyToken: m.generateVerifyToken, hashToken: m.hashToken }));
vi.mock("@/modules/admin/users/base-url", () => ({ buildVerifyLink: m.buildVerifyLink, HostMismatchError: class extends Error {} }));
vi.mock("@/modules/admin/users/mail-templates", () => ({ buildVerifyEmailMail: m.buildVerifyEmailMail }));
vi.mock("@/modules/admin/users/errors", () => ({ RateLimitError: class extends Error {}, TokenError: class extends Error {}, UserConflictError: class extends Error {}, UserValidationError: class extends Error {} }));

import { POST } from "@/app/api/auth/resend-verification/route";

const req = (b: object) => new Request("http://localhost/api/auth/resend-verification", {
  method: "POST", body: JSON.stringify(b), headers: { "Content-Type": "application/json" },
});

beforeEach(() => { vi.clearAllMocks(); });

describe("POST /api/auth/resend-verification", () => {
  it("미검증 PENDING 존재: 토큰갱신+메일 재enqueue를 refreshVerifyToken에 위임 + drain + 중립 202 (mail 인자 전달·canonical 링크)", async () => {
    m.enforceResendCooldown.mockResolvedValue(undefined);
    m.refreshVerifyToken.mockResolvedValue({ id: "u1" });
    const res = await POST(req({ email: "a@x.com" }));
    expect([200, 202]).toContain(res.status);
    // 링크는 canonical base URL 헬퍼로 생성한다(요청 Host 신뢰 금지 — finding F).
    expect(m.buildVerifyLink).toHaveBeenCalledWith(expect.any(Request), "plain");
    // 라우트는 mail 본문을 만들어 refreshVerifyToken에 넘긴다(별도 enqueue 트랜잭션 없음 — finding #4).
    expect(m.refreshVerifyToken).toHaveBeenCalledWith("a@x.com", "hash:plain", expect.any(Date), expect.objectContaining({ recipients: ["a@x.com"], subject: "verify" }));
    expect(m.triggerLeaveMailDrain).toHaveBeenCalled();
  });

  it("스푸핑된 Host(buildVerifyLink 거부): refreshVerifyToken·drain 미호출 + 400 (finding F)", async () => {
    const { HostMismatchError } = await import("@/modules/admin/users/base-url");
    m.enforceResendCooldown.mockResolvedValue(undefined);
    m.buildVerifyLink.mockImplementationOnce(() => { throw new HostMismatchError("untrusted host"); });
    const res = await POST(req({ email: "victim@x.com" }));
    // 공개 resend는 공격자가 피해자 이메일로 부를 수 있다 — host 스푸핑이면 토큰을 만들기도 전에 거부.
    expect(m.refreshVerifyToken).not.toHaveBeenCalled();
    expect(m.triggerLeaveMailDrain).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });
  it("존재하지 않는 이메일(refreshVerifyToken null): 동일 중립 응답·drain 미호출(열거 방지)", async () => {
    m.enforceResendCooldown.mockResolvedValue(undefined);
    m.refreshVerifyToken.mockResolvedValue(null);
    const res = await POST(req({ email: "ghost@x.com" }));
    expect([200, 202]).toContain(res.status);
    expect(m.triggerLeaveMailDrain).not.toHaveBeenCalled();
  });
  it("쿨다운 위반: 429, refreshVerifyToken 미호출", async () => {
    const { RateLimitError } = await import("@/modules/admin/users/errors");
    m.enforceResendCooldown.mockRejectedValueOnce(new RateLimitError("cooldown"));
    const res = await POST(req({ email: "a@x.com" }));
    expect(res.status).toBe(429);
    expect(m.refreshVerifyToken).not.toHaveBeenCalled();
  });
  it("이메일 형식 아니면 400", async () => {
    const res = await POST(req({ email: "nope" }));
    expect(res.status).toBe(400);
  });
});
