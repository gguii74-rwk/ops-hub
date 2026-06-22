import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const ORIG = { ...process.env };
afterEach(() => { process.env = { ...ORIG }; vi.unstubAllEnvs(); });
beforeEach(() => { delete process.env.AUTH_URL; delete process.env.NEXTAUTH_URL; });

describe("buildVerifyLink (finding F — canonical base URL, host 스푸핑 거부)", () => {
  it("AUTH_URL을 canonical로 써서 절대 verify 링크를 만든다(요청 Host 무시)", async () => {
    process.env.AUTH_URL = "https://ops.example.com";
    const { buildVerifyLink } = await import("@/modules/admin/users/base-url");
    const req = new Request("https://ops.example.com/api/auth/signup", { headers: { host: "ops.example.com" } });
    expect(buildVerifyLink(req, "plain-token")).toBe("https://ops.example.com/verify-email?token=plain-token");
  });
  it("AUTH_URL이 없으면 NEXTAUTH_URL로 폴백", async () => {
    process.env.NEXTAUTH_URL = "https://ops.example.com";
    const { buildVerifyLink } = await import("@/modules/admin/users/base-url");
    const req = new Request("https://ops.example.com/api/auth/signup", { headers: { host: "ops.example.com" } });
    expect(buildVerifyLink(req, "t")).toBe("https://ops.example.com/verify-email?token=t");
  });
  it("스푸핑된 Host(canonical과 불일치)면 토큰 생성 전 거부(throw) — 링크에 절대 안 실림", async () => {
    process.env.AUTH_URL = "https://ops.example.com";
    const { buildVerifyLink, HostMismatchError } = await import("@/modules/admin/users/base-url");
    const spoofed = new Request("https://ops.example.com/api/auth/resend-verification", { headers: { host: "evil.attacker.com" } });
    expect(() => buildVerifyLink(spoofed, "secret-token")).toThrow(HostMismatchError);
  });
  it("스푸핑된 X-Forwarded-Host(canonical과 불일치)도 거부", async () => {
    process.env.AUTH_URL = "https://ops.example.com";
    const { buildVerifyLink, HostMismatchError } = await import("@/modules/admin/users/base-url");
    const spoofed = new Request("https://ops.example.com/api/auth/resend-verification", {
      headers: { host: "ops.example.com", "x-forwarded-host": "evil.attacker.com" },
    });
    expect(() => buildVerifyLink(spoofed, "secret-token")).toThrow(HostMismatchError);
  });
  it("canonical과 일치하는 Host는 통과(정상 프록시)", async () => {
    process.env.AUTH_URL = "https://ops.example.com";
    const { buildVerifyLink } = await import("@/modules/admin/users/base-url");
    const ok = new Request("http://internal/api/auth/signup", { headers: { host: "ops.example.com" } });
    expect(buildVerifyLink(ok, "t")).toBe("https://ops.example.com/verify-email?token=t");
  });
  it("AUTH_URL·NEXTAUTH_URL 둘 다 없으면 설정 오류(throw, 링크 생성 불가)", async () => {
    const { buildVerifyLink } = await import("@/modules/admin/users/base-url");
    const req = new Request("https://ops.example.com/api/auth/signup", { headers: { host: "ops.example.com" } });
    expect(() => buildVerifyLink(req, "t")).toThrow();
  });
});
