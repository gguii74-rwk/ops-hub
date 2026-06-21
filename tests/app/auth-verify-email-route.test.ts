import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  setPasswordViaToken: vi.fn(), hashToken: vi.fn((t: string) => `hash:${t}`),
  userFindFirst: vi.fn(), hash: vi.fn(async () => "bcrypt-hash"),
}));
vi.mock("@/modules/admin/users/repositories", () => ({ setPasswordViaToken: m.setPasswordViaToken }));
vi.mock("@/modules/admin/users/token", () => ({ hashToken: m.hashToken }));
vi.mock("bcryptjs", () => ({ default: { hash: m.hash } }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: m.userFindFirst } } }));

import { GET, POST } from "@/app/api/auth/verify-email/route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/auth/verify-email (토큰 유효성)", () => {
  it("유효(미만료) 토큰이면 200 valid", async () => {
    m.userFindFirst.mockResolvedValue({ id: "u1", emailVerifyExpiresAt: new Date(Date.now() + 100000) });
    const res = await GET(new Request("http://x/api/auth/verify-email?token=abc"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ valid: true });
  });
  it("만료/위조 토큰이면 400", async () => {
    m.userFindFirst.mockResolvedValue(null);
    const res = await GET(new Request("http://x/api/auth/verify-email?token=bad"));
    expect(res.status).toBe(400);
  });
  it("token 쿼리 없으면 400", async () => {
    const res = await GET(new Request("http://x/api/auth/verify-email"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/verify-email (set-password)", () => {
  it("유효 토큰 + 12자+ → passwordHash·emailVerifiedAt 설정(setPasswordViaToken) 200", async () => {
    m.setPasswordViaToken.mockResolvedValue({ id: "u1" });
    const res = await POST(new Request("http://x/api/auth/verify-email", {
      method: "POST", body: JSON.stringify({ token: "abc", password: "123456789012" }), headers: { "Content-Type": "application/json" },
    }));
    expect(res.status).toBe(200);
    expect(m.hash).toHaveBeenCalledWith("123456789012", 10); // bcrypt cost 10(seed와 동일)
    expect(m.setPasswordViaToken).toHaveBeenCalledWith("hash:abc", "bcrypt-hash", expect.any(Date));
  });
  it("만료/위조 토큰(setPasswordViaToken null) → 400", async () => {
    m.setPasswordViaToken.mockResolvedValue(null);
    const res = await POST(new Request("http://x/api/auth/verify-email", {
      method: "POST", body: JSON.stringify({ token: "bad", password: "123456789012" }), headers: { "Content-Type": "application/json" },
    }));
    expect(res.status).toBe(400);
  });
  it("12자 미만 비번 → 400(zod), setPasswordViaToken 미호출", async () => {
    const res = await POST(new Request("http://x/api/auth/verify-email", {
      method: "POST", body: JSON.stringify({ token: "abc", password: "short" }), headers: { "Content-Type": "application/json" },
    }));
    expect(res.status).toBe(400);
    expect(m.setPasswordViaToken).not.toHaveBeenCalled();
  });
});
