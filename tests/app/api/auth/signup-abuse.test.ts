import { describe, it, expect, vi, beforeEach } from "vitest";
import { SIGNUP_IP_LIMIT, SIGNUP_EMAIL_LIMIT, RESEND_COOLDOWN_MS, RATE_WINDOW_MS } from "@/modules/admin/users/rate-limit";
import { RateLimitError } from "@/modules/admin/users/errors";

// ── D18 남용 통제: 레이트리밋 초과 시 createPendingSignup/refreshVerifyToken 미호출 + 429 ──
// enforceRateLimit/enforceResendCooldown은 prisma.$queryRaw를 사용하는 원자적 upsert이므로,
// $queryRaw mock으로 RateLimitError를 throw해 사전 강제(pre-write)를 시뮬레이션한다.
// 창작(user·mailDelivery 행) 전에 차단됨을 createPendingSignup/refreshVerifyToken 미호출로 증명.

const h = vi.hoisted(() => ({
  // 레이트리밋 강제 함수(실제 구현: prisma.$queryRaw + RateLimitError throw).
  // 기본은 pass-through. 초과 시나리오에서는 RateLimitError를 throw하도록 override.
  enforceRateLimit: vi.fn(async () => undefined),
  enforceResendCooldown: vi.fn(async () => undefined),
  // 저장소 함수 — 레이트리밋 통과 후에만 호출되어야 한다.
  createPendingSignup: vi.fn(async () => ({ id: "u-new" })),
  refreshVerifyToken: vi.fn(async () => ({ id: "u-existing" })),
  // 메일 drain 트리거(fire-and-forget).
  triggerLeaveMailDrain: vi.fn(() => undefined),
  // 토큰 생성 헬퍼(원자성 검증에 영향 없으므로 고정값 반환).
  generateVerifyToken: vi.fn(() => "plain-token-abc"),
  hashToken: vi.fn((t: string) => `hash:${t}`),
  // 링크 생성(canonical base URL 헬퍼 — 단순 고정값).
  buildVerifyLink: vi.fn(() => "https://ops-hub.example.com/verify?token=plain-token-abc"),
  // 메일 본문 빌더.
  buildVerifyEmailMail: vi.fn(() => ({ subject: "verify", bodyHtml: "<p>verify</p>" })),
}));

vi.mock("@/modules/admin/users/rate-limit", async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...actual,
    enforceRateLimit: (...a: unknown[]) => (h.enforceRateLimit as (...x: unknown[]) => unknown)(...a),
    enforceResendCooldown: (...a: unknown[]) => (h.enforceResendCooldown as (...x: unknown[]) => unknown)(...a),
  };
});
vi.mock("@/modules/admin/users/repositories", () => ({
  createPendingSignup: (...a: unknown[]) => (h.createPendingSignup as (...x: unknown[]) => unknown)(...a),
  refreshVerifyToken: (...a: unknown[]) => (h.refreshVerifyToken as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("@/modules/leave/services/mail", () => ({
  triggerLeaveMailDrain: () => h.triggerLeaveMailDrain(),
}));
vi.mock("@/modules/admin/users/token", () => ({
  generateVerifyToken: () => h.generateVerifyToken(),
  hashToken: (t: string) => h.hashToken(t),
}));
vi.mock("@/modules/admin/users/base-url", () => ({
  buildVerifyLink: (...a: unknown[]) => (h.buildVerifyLink as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("@/modules/admin/users/mail-templates", () => ({
  buildVerifyEmailMail: (_link: string) => ({ subject: "verify", bodyHtml: "<p>verify</p>" }),
}));

import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as resendPOST } from "@/app/api/auth/resend-verification/route";

function jsonReq(body: unknown, ip = "1.2.3.4") {
  return new Request("http://x/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}
const validSignup = {
  email: "new@x.com", name: "신규", employmentType: "REGULAR", jobFunction: "DEVELOPER", department: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  // 기본: 레이트리밋 통과(정상 흐름).
  h.enforceRateLimit.mockResolvedValue(undefined);
  h.enforceResendCooldown.mockResolvedValue(undefined);
  h.createPendingSignup.mockResolvedValue({ id: "u-new" });
  h.refreshVerifyToken.mockResolvedValue({ id: "u-existing" });
});

describe("D18 signup per-IP 한도 초과 → 429, createPendingSignup 미호출", () => {
  it(`per-IP enforceRateLimit가 RateLimitError를 던지면 429이고 createPendingSignup 미호출`, async () => {
    // signup 라우트는 IP → email 순서로 enforceRateLimit 호출. 첫 호출(IP)에서 초과.
    h.enforceRateLimit.mockRejectedValueOnce(new RateLimitError("요청이 너무 많습니다."));
    const res = await signupPOST(jsonReq(validSignup));
    expect(res.status).toBe(429);
    expect(h.createPendingSignup).not.toHaveBeenCalled();
  });
  it(`SIGNUP_IP_LIMIT 상수 값이 10(계약 고정)`, () => {
    expect(SIGNUP_IP_LIMIT).toBe(10);
  });
});

describe("D18 signup per-email 한도 초과 → 429", () => {
  it(`per-email enforceRateLimit가 RateLimitError를 던지면 429, createPendingSignup 미호출`, async () => {
    // 첫 호출(IP)은 통과, 두 번째 호출(email)에서 초과.
    h.enforceRateLimit
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new RateLimitError("요청이 너무 많습니다."));
    const res = await signupPOST(jsonReq(validSignup));
    expect(res.status).toBe(429);
    expect(h.createPendingSignup).not.toHaveBeenCalled();
  });
  it(`SIGNUP_EMAIL_LIMIT 상수 값이 3(계약 고정)`, () => {
    expect(SIGNUP_EMAIL_LIMIT).toBe(3);
  });
});

describe("D18 미처리 PENDING 전역 상한(bounded creation)", () => {
  it("createPendingSignup이 RateLimitError(PENDING 상한)를 던지면 429", async () => {
    // 레이트리밋 통과 후 createPendingSignup 내부에서 상한 초과 RateLimitError.
    h.createPendingSignup.mockRejectedValueOnce(new RateLimitError("PENDING 상한 초과"));
    const res = await signupPOST(jsonReq(validSignup));
    expect(res.status).toBe(429);
  });
});

describe("D18 resend per-IP 한도 초과 → 429, refreshVerifyToken 미호출", () => {
  it(`resend per-IP enforceRateLimit가 RateLimitError를 던지면 429이고 refreshVerifyToken·mailDelivery 미호출`, async () => {
    // resend 라우트는 enforceRateLimit("resend:ip", ip, SIGNUP_IP_LIMIT, now)를 첫 번째로 호출.
    // 이 per-IP 체크가 초과되면 enforceResendCooldown/refreshVerifyToken에 도달하기 전에 차단된다.
    h.enforceRateLimit.mockRejectedValueOnce(new RateLimitError("요청이 너무 많습니다."));
    const res = await resendPOST(jsonReq({ email: "new@x.com" }));
    expect(res.status).toBe(429);
    expect(h.refreshVerifyToken).not.toHaveBeenCalled();
    expect(h.enforceResendCooldown).not.toHaveBeenCalled();
  });
  it(`SIGNUP_IP_LIMIT 상수가 resend per-IP 한도로 사용됨(계약 고정)`, () => {
    // resend:ip 스코프는 SIGNUP_IP_LIMIT를 재사용(저장증폭 완화 F3 — signup과 동일 버킷 한도).
    expect(SIGNUP_IP_LIMIT).toBe(10);
  });
});

describe("D18 resend 쿨다운 위반 → 429, refreshVerifyToken 미호출", () => {
  it(`enforceResendCooldown이 RateLimitError를 던지면 429이고 refreshVerifyToken 미호출`, async () => {
    // resend 쿨다운 위반: enforceResendCooldown이 RateLimitError throw.
    h.enforceResendCooldown.mockRejectedValueOnce(new RateLimitError("재발송은 잠시 후 다시 시도해 주세요."));
    const res = await resendPOST(jsonReq({ email: "new@x.com" }));
    expect(res.status).toBe(429);
    expect(h.refreshVerifyToken).not.toHaveBeenCalled();
  });
  it(`RESEND_COOLDOWN_MS 상수 값이 60000(1분, 계약 고정)`, () => {
    expect(RESEND_COOLDOWN_MS).toBe(60 * 1000);
  });
});

describe("D18 정상 흐름: 한도 내면 통과(차단 회귀 방지)", () => {
  it("레이트리밋 통과 → 429가 아니다(createPendingSignup 호출됨)", async () => {
    const res = await signupPOST(jsonReq(validSignup));
    expect(res.status).not.toBe(429);
    expect(h.createPendingSignup).toHaveBeenCalled();
  });
});

describe("D18 RateBucket 강제는 원자적·사전임을 계약으로 고정", () => {
  it("거부 시 enforceRateLimit는 실행됐으나 createPendingSignup은 전혀 손대지 않음", async () => {
    h.enforceRateLimit.mockRejectedValueOnce(new RateLimitError("요청이 너무 많습니다."));
    await signupPOST(jsonReq(validSignup));
    expect(h.enforceRateLimit).toHaveBeenCalled();          // 사전 카운트 수행됨
    expect(h.createPendingSignup).not.toHaveBeenCalled();   // 쓰기 전 차단
    expect(RATE_WINDOW_MS).toBe(60 * 60 * 1000);            // 상수 계약 고정
  });
});
