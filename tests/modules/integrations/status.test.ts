import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  getSmtpCfg, setSmtpCfg, getCalendarIds, setCalendarIds, getCalendarThrows, setCalendarThrows,
  getSecretHealth, setSecretHealth, getAllowed, setAllowed,
} = vi.hoisted(() => {
  let smtpCfg = { host: "", port: 587, secure: false, user: "", from: "" };
  let calendarIds: unknown = [];
  let calendarThrows: null | "invalid" | "infra" = null;
  let secretHealth: Record<string, "configured" | "attention_required"> = {
    smtp: "attention_required", google: "attention_required", templates: "attention_required",
  };
  let allowed = new Set<string>(["integrations.smtp:view", "integrations.google:view", "integrations.templates:view"]);
  return {
    getSmtpCfg: () => smtpCfg, setSmtpCfg: (c: typeof smtpCfg) => { smtpCfg = c; },
    getCalendarIds: () => calendarIds, setCalendarIds: (v: unknown) => { calendarIds = v; },
    getCalendarThrows: () => calendarThrows, setCalendarThrows: (v: null | "invalid" | "infra") => { calendarThrows = v; },
    getSecretHealth: () => secretHealth, setSecretHealth: (h: typeof secretHealth) => { secretHealth = h; },
    getAllowed: () => allowed, setAllowed: (s: Set<string>) => { allowed = s; },
  };
});

vi.mock("@/kernel/settings/reader", () => {
  class SettingInvalidError extends Error {}
  return {
    getSmtpConfig: async () => getSmtpCfg(),
    getSetting: async (k: string) => {
      if (k === "integrations.google.calendarIds") {
        if (getCalendarThrows() === "invalid") throw new SettingInvalidError(k);
        if (getCalendarThrows() === "infra") throw new Error("ECONNREFUSED");
        return getCalendarIds();
      }
      throw new Error("unexpected key " + k);
    },
    SettingInvalidError,
  };
});

vi.mock("@/lib/env", () => ({
  getSecretStatus: (specs: Array<{ id: string }>) =>
    specs.map((s) => ({ id: s.id, health: getSecretHealth()[s.id] ?? "attention_required" })),
}));

vi.mock("@/kernel/access", () => ({
  hasPermission: async (_u: string, resource: string, action: string) => getAllowed().has(`${resource}:${action}`),
}));

import { getIntegrationStatuses } from "@/modules/integrations";

const smtpHealth = (out: { key: string; health: string }[]) => out.find((s) => s.key === "smtp")!.health;

beforeEach(() => {
  setSmtpCfg({ host: "", port: 587, secure: false, user: "", from: "" });
  setCalendarIds([]);
  setCalendarThrows(null);
  setSecretHealth({ smtp: "attention_required", google: "attention_required", templates: "attention_required" });
  setAllowed(new Set(["integrations.smtp:view", "integrations.google:view", "integrations.templates:view"]));
});

describe("smtpConfigured — 전송 auth 분기 일치(D5·F9)", () => {
  it("① host + SMTP_USER + SMTP_PASSWORD → configured", async () => {
    setSmtpCfg({ host: "mail.x", port: 587, secure: false, user: "bob", from: "" });
    setSecretHealth({ ...getSecretHealth(), smtp: "configured" });
    expect(smtpHealth(await getIntegrationStatuses("u1"))).toBe("configured");
  });
  it("② host + SMTP_USER 없음(무인증 릴레이) → configured(비밀번호 무관)", async () => {
    setSmtpCfg({ host: "mail.x", port: 587, secure: false, user: "", from: "" });
    setSecretHealth({ ...getSecretHealth(), smtp: "attention_required" });
    expect(smtpHealth(await getIntegrationStatuses("u1"))).toBe("configured");
  });
  it("③ host + SMTP_USER 있는데 SMTP_PASSWORD 없음 → attention_required", async () => {
    setSmtpCfg({ host: "mail.x", port: 587, secure: false, user: "bob", from: "" });
    setSecretHealth({ ...getSecretHealth(), smtp: "attention_required" });
    expect(smtpHealth(await getIntegrationStatuses("u1"))).toBe("attention_required");
  });
  it("④ host 없음 → attention_required(user/password 무관)", async () => {
    setSmtpCfg({ host: "", port: 587, secure: false, user: "bob", from: "" });
    setSecretHealth({ ...getSecretHealth(), smtp: "configured" });
    expect(smtpHealth(await getIntegrationStatuses("u1"))).toBe("attention_required");
  });
  it("smtp는 unknown이 나오지 않는다(getSmtpConfig tolerant → safe 미사용)", async () => {
    setSmtpCfg({ host: "mail.x", port: 587, secure: false, user: "", from: "" });
    expect(["configured", "attention_required"]).toContain(smtpHealth(await getIntegrationStatuses("u1")));
  });
});

describe("googleConfigured (현행 유지) + safe 3-state", () => {
  it("secret OK + calendarIds 있음 → configured", async () => {
    setSecretHealth({ ...getSecretHealth(), google: "configured" });
    setCalendarIds(["cal-1"]);
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "google")!.health).toBe("configured");
  });
  it("secret OK + calendarIds 비어있음 → attention_required", async () => {
    setSecretHealth({ ...getSecretHealth(), google: "configured" });
    setCalendarIds([]);
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "google")!.health).toBe("attention_required");
  });
  it("secret 미설정 → attention_required(설정값 조회 없이)", async () => {
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "google")!.health).toBe("attention_required");
  });
  it("getSetting SettingInvalidError(무효 저장값) → attention_required", async () => {
    setSecretHealth({ ...getSecretHealth(), google: "configured" });
    setCalendarThrows("invalid");
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "google")!.health).toBe("attention_required");
  });
  it("getSetting 예상 못한 에러(인프라 장애) → unknown(google 로그)", async () => {
    setSecretHealth({ ...getSecretHealth(), google: "configured" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setCalendarThrows("infra");
    const out = await getIntegrationStatuses("u1");
    expect(out.find((s) => s.key === "google")!.health).toBe("unknown");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("google"), expect.anything());
    spy.mockRestore();
  });
});

describe("templates + 권한 게이트", () => {
  it("templates: secret OK → configured(설정값 불필요)", async () => {
    setSecretHealth({ ...getSecretHealth(), templates: "configured" });
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "templates")!.health).toBe("configured");
  });
  it("integrations.<key>:view 없는 연동은 결과에서 제외", async () => {
    setAllowed(new Set(["integrations.smtp:view"]));
    setSmtpCfg({ host: "mail.x", port: 587, secure: false, user: "", from: "" });
    expect((await getIntegrationStatuses("u1")).map((s) => s.key)).toEqual(["smtp"]);
  });
});
