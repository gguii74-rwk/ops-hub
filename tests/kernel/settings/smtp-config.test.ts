import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// readRaw를 교체 가능한 impl로 mock(tolerant 테스트에서 throw 주입).
const { store, getReadRaw, setReadRaw } = vi.hoisted(() => {
  const store = new Map<string, { value: unknown; updatedAt: Date }>();
  let impl: (k: string) => Promise<{ value: unknown; updatedAt: Date } | null> = async (k) => store.get(k) ?? null;
  return { store, getReadRaw: () => impl, setReadRaw: (fn: typeof impl) => { impl = fn; } };
});
vi.mock("@/kernel/settings/repository", () => ({ readRaw: (k: string) => getReadRaw()(k), writeWithAudit: vi.fn() }));
// service.ts top-level import 부수효과 차단(getSmtpConfig는 access/env를 호출하지 않음).
vi.mock("@/kernel/access", () => ({ hasPermission: vi.fn(), requirePermission: vi.fn() }));
vi.mock("@/lib/env", () => ({ getSecretStatus: vi.fn(() => []) }));

import { getSmtpConfig } from "@/kernel/settings/reader";

const ENV_KEYS = ["SMTP_HOST", "SMTP_USER", "SMTP_SECURE", "SMTP_PORT", "SMTP_FROM"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  store.clear();
  setReadRaw(async (k) => store.get(k) ?? null);
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe("getSmtpConfig — env 전용 필드(host/user/secure, D2·F4)", () => {
  it("host/user/secure는 env에서만 읽는다(DB row 있어도 무시)", async () => {
    process.env.SMTP_HOST = "mail.x";
    process.env.SMTP_USER = "bob";
    process.env.SMTP_SECURE = "true";
    store.set("integrations.smtp.host", { value: "db-ignored", updatedAt: new Date() });
    const cfg = await getSmtpConfig();
    expect(cfg.host).toBe("mail.x");
    expect(cfg.user).toBe("bob");
    expect(cfg.secure).toBe(true);
  });
  it("env 미설정 → host/user '', secure false", async () => {
    expect(await getSmtpConfig()).toMatchObject({ host: "", user: "", secure: false });
  });
});

describe("getSmtpConfig — port(env 전용, P3/A2)", () => {
  it("SMTP_PORT=465 → 465", async () => {
    process.env.SMTP_PORT = "465";
    expect((await getSmtpConfig()).port).toBe(465);
  });
  it("env 없음 → 587", async () => {
    expect((await getSmtpConfig()).port).toBe(587);
  });
  it("DB row가 있어도 무시(port는 env 전용 — orphan)", async () => {
    process.env.SMTP_PORT = "465";
    store.set("integrations.smtp.port", { value: 2525, updatedAt: new Date() });
    expect((await getSmtpConfig()).port).toBe(465); // DB 2525 무시, env 465
  });
  it("SMTP_PORT 무효(NaN) → 587", async () => {
    process.env.SMTP_PORT = "not-a-number";
    expect((await getSmtpConfig()).port).toBe(587);
  });
  it("SMTP_PORT='' (빈 문자열) → 587 (Number('')===0 함정, P5)", async () => {
    process.env.SMTP_PORT = "";
    expect((await getSmtpConfig()).port).toBe(587);
  });
  it("SMTP_PORT='   ' (공백) → 587 (P5)", async () => {
    process.env.SMTP_PORT = "   ";
    expect((await getSmtpConfig()).port).toBe(587);
  });
  it("SMTP_PORT='0' (범위 밖) → 587 (P5)", async () => {
    process.env.SMTP_PORT = "0";
    expect((await getSmtpConfig()).port).toBe(587);
  });
  it("SMTP_PORT='70000' (>65535) → 587 (P5)", async () => {
    process.env.SMTP_PORT = "70000";
    expect((await getSmtpConfig()).port).toBe(587);
  });
});

describe("getSmtpConfig — from(readRaw, DB 우선·env 폴백)", () => {
  it("행 존재+비어있지 않음 → DB", async () => {
    process.env.SMTP_FROM = "envfrom@x.com";
    store.set("integrations.smtp.fromAddress", { value: "dbfrom@x.com", updatedAt: new Date() });
    expect((await getSmtpConfig()).from).toBe("dbfrom@x.com");
  });
  it("행 부재 → env SMTP_FROM", async () => {
    process.env.SMTP_FROM = "envfrom@x.com";
    expect((await getSmtpConfig()).from).toBe("envfrom@x.com");
  });
  it("행 빈 문자열 → env 폴백(빈값은 DB로 안 침)", async () => {
    process.env.SMTP_FROM = "envfrom@x.com";
    store.set("integrations.smtp.fromAddress", { value: "", updatedAt: new Date() });
    expect((await getSmtpConfig()).from).toBe("envfrom@x.com");
  });
  it("행 무효(비어있지 않은 비-이메일) + 유효 env SMTP_FROM → env 폴백, throw 없음(P1·D10)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.SMTP_FROM = "envfrom@x.com";
    store.set("integrations.smtp.fromAddress", { value: "not-an-email", updatedAt: new Date() });
    expect((await getSmtpConfig()).from).toBe("envfrom@x.com"); // 무효 행이 env를 덮지 않음
    warn.mockRestore();
  });
  it("env 전부 없음 → 기본 noreply", async () => {
    expect((await getSmtpConfig()).from).toBe("noreply@uracle.co.kr");
  });
});

describe("getSmtpConfig — tolerant(D10·F2, 절대 throw 안 함)", () => {
  it("readRaw throw(인프라 장애) + env present → env config로 해석, throw 없음", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.SMTP_HOST = "mail.x";
    process.env.SMTP_PORT = "2525";
    process.env.SMTP_FROM = "envfrom@x.com";
    setReadRaw(async () => { throw new Error("DB down"); });
    const cfg = await getSmtpConfig();
    expect(cfg).toMatchObject({ host: "mail.x", port: 2525, from: "envfrom@x.com" });
    warn.mockRestore();
  });
});
