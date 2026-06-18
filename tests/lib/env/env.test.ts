import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIG = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG };
  vi.resetModules();
});
beforeEach(() => vi.resetModules());

describe("lib/env boot 검증", () => {
  it("required env 누락 시 import에서 throw(fail-fast)", async () => {
    delete process.env.DATABASE_URL;
    process.env.NEXTAUTH_SECRET = "x";
    await expect(import("@/lib/env")).rejects.toThrow();
  });

  it("required env 충족 시 env 노출", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    process.env.NEXTAUTH_SECRET = "secret";
    const mod = await import("@/lib/env");
    expect(mod.env.DATABASE_URL).toBe("postgresql://localhost/db");
  });

  it("NEXTAUTH_SECRET 없이 AUTH_SECRET만 있어도 통과(Phase 1 auth 정합)", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    delete process.env.NEXTAUTH_SECRET;
    process.env.AUTH_SECRET = "secret";
    const mod = await import("@/lib/env");
    expect(mod.env.AUTH_SECRET).toBe("secret");
  });

  it("NEXTAUTH_SECRET·AUTH_SECRET 둘 다 없으면 throw", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
    await expect(import("@/lib/env")).rejects.toThrow();
  });
});

describe("getSecretStatus (coarse)", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    process.env.NEXTAUTH_SECRET = "secret";
  });

  it("value var 존재→configured, 누락→attention_required", async () => {
    process.env.SMTP_PASSWORD = "pw";
    delete process.env.LIBREOFFICE_PATH;
    const { getSecretStatus } = await import("@/lib/env");
    const out = getSecretStatus([
      { id: "secret.smtp", vars: [{ name: "SMTP_PASSWORD", kind: "value" }] },
      { id: "secret.libreoffice", vars: [{ name: "LIBREOFFICE_PATH", kind: "filePath" }] },
    ]);
    expect(out).toEqual([
      { id: "secret.smtp", health: "configured" },
      { id: "secret.libreoffice", health: "attention_required" },
    ]);
  });

  it("filePath var는 실제 파일 존재로 판정", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "./package.json"; // 실재 파일
    const { getSecretStatus } = await import("@/lib/env");
    const out = getSecretStatus([
      { id: "secret.google", vars: [{ name: "GOOGLE_APPLICATION_CREDENTIALS", kind: "filePath" }] },
    ]);
    expect(out[0]).toEqual({ id: "secret.google", health: "configured" });
  });

  it("값/변수명/경로를 반환에 포함하지 않는다", async () => {
    process.env.SMTP_PASSWORD = "super-secret-value";
    const { getSecretStatus } = await import("@/lib/env");
    const out = getSecretStatus([{ id: "secret.smtp", vars: [{ name: "SMTP_PASSWORD", kind: "value" }] }]);
    const json = JSON.stringify(out);
    expect(json).not.toContain("super-secret-value");
    expect(json).not.toContain("SMTP_PASSWORD");
    expect(Object.keys(out[0]).sort()).toEqual(["health", "id"]);
  });

  it("aliases: 대체 변수(AUTH_SECRET)만 있어도 configured", async () => {
    delete process.env.NEXTAUTH_SECRET;
    process.env.AUTH_SECRET = "s";
    const { getSecretStatus } = await import("@/lib/env");
    const out = getSecretStatus([
      { id: "secret.auth", vars: [{ name: "NEXTAUTH_SECRET", kind: "value", aliases: ["AUTH_SECRET"] }] },
    ]);
    expect(out[0]).toEqual({ id: "secret.auth", health: "configured" });
  });
});
