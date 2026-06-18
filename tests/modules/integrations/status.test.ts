import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.hoisted: mock factory보다 먼저 평가되므로 mutable 상태를 getter/setter로 노출한다.
// factory 내부에서 getXxx()/setXxx()로 접근 → TDZ(Cannot access before initialization) 방지.
const { getSettings, getSettingImpl, setSettingImpl, getSecretHealth, setSecretHealth, getAllowed, setAllowed } =
  vi.hoisted(() => {
    const settings = new Map<string, unknown>();
    let getSettingImplFn: (k: string) => Promise<unknown> = async (k) => {
      if (!settings.has(k)) throw new Error("unexpected key " + k);
      return settings.get(k);
    };
    let secretHealth: Record<string, "configured" | "attention_required"> = {
      smtp: "attention_required",
      google: "attention_required",
      templates: "attention_required",
    };
    let allowed = new Set<string>(["integrations.smtp:view", "integrations.google:view", "integrations.templates:view"]);

    return {
      getSettings: () => settings,
      getSettingImpl: () => getSettingImplFn,
      setSettingImpl: (fn: (k: string) => Promise<unknown>) => { getSettingImplFn = fn; },
      getSecretHealth: () => secretHealth,
      setSecretHealth: (h: Record<string, "configured" | "attention_required">) => { secretHealth = h; },
      getAllowed: () => allowed,
      setAllowed: (s: Set<string>) => { allowed = s; },
    };
  });

vi.mock("@/kernel/settings/reader", () => {
  // SettingInvalidError는 factory 내부에 정의(hoist TDZ 회피). status.ts가 같은 모듈에서
  // import하므로 동일 클래스를 공유 → instanceof 구분이 성립한다.
  class SettingInvalidError extends Error {}
  return {
    getSetting: (k: string) => getSettingImpl()(k),
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
import { SettingInvalidError } from "@/kernel/settings/reader";

beforeEach(() => {
  getSettings().clear();
  setSettingImpl(async (k) => {
    if (!getSettings().has(k)) throw new Error("unexpected key " + k);
    return getSettings().get(k);
  });
  setSecretHealth({ smtp: "attention_required", google: "attention_required", templates: "attention_required" });
  setAllowed(new Set(["integrations.smtp:view", "integrations.google:view", "integrations.templates:view"]));
});

describe("getIntegrationStatuses", () => {
  it("secret 미설정이면 attention_required(설정값 조회 없이)", async () => {
    const out = await getIntegrationStatuses("u1");
    expect(out).toEqual([
      { key: "smtp", health: "attention_required" },
      { key: "google", health: "attention_required" },
      { key: "templates", health: "attention_required" },
    ]);
  });

  it("smtp: secret OK + host·from·port 채워짐 → configured", async () => {
    setSecretHealth({ ...getSecretHealth(), smtp: "configured" });
    getSettings().set("integrations.smtp.host", "mail.x");
    getSettings().set("integrations.smtp.fromAddress", "ops@x.com");
    getSettings().set("integrations.smtp.port", 587);
    const out = await getIntegrationStatuses("u1");
    expect(out.find((s) => s.key === "smtp")!.health).toBe("configured");
  });

  it("smtp: secret OK지만 host 빈값 → attention_required", async () => {
    setSecretHealth({ ...getSecretHealth(), smtp: "configured" });
    getSettings().set("integrations.smtp.host", "");
    getSettings().set("integrations.smtp.fromAddress", "ops@x.com");
    getSettings().set("integrations.smtp.port", 587);
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "smtp")!.health).toBe("attention_required");
  });

  it("smtp: secret·host·from OK지만 port 무효(getSetting이 SettingInvalidError throw) → attention_required", async () => {
    setSecretHealth({ ...getSecretHealth(), smtp: "configured" });
    getSettings().set("integrations.smtp.host", "mail.x");
    getSettings().set("integrations.smtp.fromAddress", "ops@x.com");
    getSettings().set("integrations.smtp.port", 587);
    const origImpl = getSettingImpl();
    setSettingImpl(async (k) =>
      k === "integrations.smtp.port" ? Promise.reject(new SettingInvalidError("integrations.smtp.port")) : origImpl(k),
    );
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "smtp")!.health).toBe("attention_required");
  });

  it("google: secret OK + calendarIds 비어있음 → attention_required", async () => {
    setSecretHealth({ ...getSecretHealth(), google: "configured" });
    getSettings().set("integrations.google.calendarIds", []);
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "google")!.health).toBe("attention_required");
  });

  it("templates: secret OK → configured(설정값 불필요)", async () => {
    setSecretHealth({ ...getSecretHealth(), templates: "configured" });
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "templates")!.health).toBe("configured");
  });

  it("getSetting이 SettingInvalidError throw(invalid 저장값)해도 크래시 없이 attention_required", async () => {
    setSecretHealth({ ...getSecretHealth(), smtp: "configured" });
    setSettingImpl(async () => { throw new SettingInvalidError("test.key"); });
    expect((await getIntegrationStatuses("u1")).find((s) => s.key === "smtp")!.health).toBe("attention_required");
  });

  it("getSetting이 예상 못한 에러(DB 장애 등) throw → unknown(설정 누락과 구분, 로그)", async () => {
    setSecretHealth({ ...getSecretHealth(), smtp: "configured" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setSettingImpl(async () => { throw new Error("ECONNREFUSED"); });
    const out = await getIntegrationStatuses("u1");
    expect(out.find((s) => s.key === "smtp")!.health).toBe("unknown");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("smtp"), expect.anything());
    spy.mockRestore();
  });

  it("integrations.<key>:view 없는 연동은 결과에서 제외", async () => {
    setAllowed(new Set(["integrations.smtp:view"]));
    const out = await getIntegrationStatuses("u1");
    expect(out.map((s) => s.key)).toEqual(["smtp"]);
  });
});
