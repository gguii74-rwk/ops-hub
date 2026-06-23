import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(), extractClientIp: vi.fn(() => "1.2.3.4"),
  createPendingSignup: vi.fn(), triggerLeaveMailDrain: vi.fn(),
  generateVerifyToken: vi.fn(() => "plain-token"), hashToken: vi.fn((t: string) => `hash:${t}`),
  buildVerifyLink: vi.fn((_req: Request, token: string) => `https://ops.example.com/verify-email?token=${token}`),
  buildVerifyEmailMail: vi.fn((link: string) => ({ subject: "verify", bodyHtml: `<a href="${link}">link</a>` })),
}));

vi.mock("@/modules/admin/users/rate-limit", () => ({
  enforceRateLimit: m.enforceRateLimit, extractClientIp: m.extractClientIp,
  PENDING_UNVERIFIED_CAP: 200, // 라우트가 createPendingSignup에 pendingCap으로 주입하는 상수
  SIGNUP_IP_LIMIT: 10,
  SIGNUP_EMAIL_LIMIT: 3,
  VERIFY_TOKEN_TTL_MS: 7 * 24 * 60 * 60 * 1000,
}));
vi.mock("@/modules/admin/users/repositories", () => ({ createPendingSignup: m.createPendingSignup }));
vi.mock("@/modules/leave/services/mail", () => ({ triggerLeaveMailDrain: m.triggerLeaveMailDrain }));
vi.mock("@/modules/admin/users/token", () => ({ generateVerifyToken: m.generateVerifyToken, hashToken: m.hashToken }));
vi.mock("@/modules/admin/users/base-url", () => ({ buildVerifyLink: m.buildVerifyLink, HostMismatchError: class extends Error {} }));
vi.mock("@/modules/admin/users/mail-templates", () => ({ buildVerifyEmailMail: m.buildVerifyEmailMail }));
vi.mock("@/modules/admin/users/errors", async () => {
  class RateLimitError extends Error {}
  class UserConflictError extends Error {}
  class TokenError extends Error {}
  class UserValidationError extends Error {}
  return { RateLimitError, UserConflictError, TokenError, UserValidationError };
});

import { POST } from "@/app/api/auth/signup/route";

const body = (b: object) => new Request("http://localhost/api/auth/signup", {
  method: "POST", body: JSON.stringify(b), headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
});
const valid = { email: "self@x.com", name: "자가", employmentType: "REGULAR", jobFunction: "DEVELOPER" };

beforeEach(() => {
  vi.clearAllMocks();
  m.extractClientIp.mockReturnValue("1.2.3.4");
});

describe("POST /api/auth/signup", () => {
  it("정상: PENDING+메일 원자 생성 위임 + drain 트리거 + 중립 202 (mail 인자 전달·canonical 링크)", async () => {
    m.enforceRateLimit.mockResolvedValue(undefined);
    m.createPendingSignup.mockResolvedValue({ id: "u-self" });
    const res = await POST(body(valid));
    expect([200, 202]).toContain(res.status);
    // 링크는 canonical base URL 헬퍼로 생성한다(요청 Host 신뢰 금지 — finding F). req+평문 토큰을 넘긴다.
    expect(m.buildVerifyLink).toHaveBeenCalledWith(expect.any(Request), "plain-token");
    // 라우트는 user+mail을 한 번의 createPendingSignup 호출로 위임한다(별도 enqueue 트랜잭션 없음 — finding #4).
    // PENDING 상한 상수를 pendingCap 인자로 주입한다(deps 역전 방지 — repository는 rate-limit.ts를 import하지 않음).
    expect(m.createPendingSignup).toHaveBeenCalledWith(expect.objectContaining({
      email: "self@x.com", tokenHash: "hash:plain-token", pendingCap: 200,
      mail: expect.objectContaining({ recipients: ["self@x.com"], subject: "verify" }),
    }));
    expect(m.triggerLeaveMailDrain).toHaveBeenCalled();
  });

  it("스푸핑된 Host(buildVerifyLink가 토큰 생성 전 거부): createPendingSignup·drain 미호출 (finding F)", async () => {
    const { HostMismatchError } = await import("@/modules/admin/users/base-url");
    m.enforceRateLimit.mockResolvedValue(undefined);
    m.buildVerifyLink.mockImplementationOnce(() => { throw new HostMismatchError("untrusted host"); });
    const res = await POST(body(valid));
    // 비밀 토큰이 공격자 origin 링크에 실려 나가는 일이 없도록, 메일 enqueue(=createPendingSignup) 자체가 안 일어난다.
    expect(m.createPendingSignup).not.toHaveBeenCalled();
    expect(m.triggerLeaveMailDrain).not.toHaveBeenCalled();
    expect(res.status).toBe(400); // mapAuthError가 HostMismatchError→400 (canonical 링크 없이는 신청 거부)
  });

  it("D18 한도 초과: createPendingSignup·drain 미호출 + 429 (pre-write)", async () => {
    const { RateLimitError } = await import("@/modules/admin/users/errors");
    m.enforceRateLimit.mockRejectedValueOnce(new RateLimitError("too many"));
    const res = await POST(body(valid));
    expect(res.status).toBe(429);
    expect(m.createPendingSignup).not.toHaveBeenCalled();
    expect(m.triggerLeaveMailDrain).not.toHaveBeenCalled();
  });

  it("PENDING 상한 초과(createPendingSignup가 트랜잭션 내 RateLimitError): drain 미호출 + 429", async () => {
    const { RateLimitError } = await import("@/modules/admin/users/errors");
    m.enforceRateLimit.mockResolvedValue(undefined);
    m.createPendingSignup.mockRejectedValueOnce(new RateLimitError("cap"));
    const res = await POST(body(valid));
    expect(res.status).toBe(429); // RateLimitError는 중립 흡수 대상 아님 — mapAuthError로 429
    expect(m.triggerLeaveMailDrain).not.toHaveBeenCalled();
  });

  it("중복 이메일(UserConflictError): 중립 202(열거 방지) — drain은 미호출", async () => {
    const { UserConflictError } = await import("@/modules/admin/users/errors");
    m.enforceRateLimit.mockResolvedValue(undefined);
    m.createPendingSignup.mockRejectedValueOnce(new UserConflictError("dup"));
    const res = await POST(body(valid));
    expect([200, 202]).toContain(res.status); // 409를 그대로 노출하지 않는다(D10 중립 메시지)
    expect(m.triggerLeaveMailDrain).not.toHaveBeenCalled();
  });

  it("zod 실패(잘못된 enum)는 400", async () => {
    const res = await POST(body({ ...valid, employmentType: "X" }));
    expect(res.status).toBe(400);
    expect(m.enforceRateLimit).not.toHaveBeenCalled();
  });

  it("잘못된 JSON은 400", async () => {
    const res = await POST(new Request("http://localhost/api/auth/signup", { method: "POST", body: "{", headers: { "Content-Type": "application/json" } }));
    expect(res.status).toBe(400);
  });
});
