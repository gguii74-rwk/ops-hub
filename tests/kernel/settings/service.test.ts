import { describe, it, expect, beforeEach, vi } from "vitest";

// --- vi.hoisted: mock factory보다 먼저 초기화 (vitest hoisting 규칙) ---
const { store, writeCalls, getAllowed, setAllowed, getBaseAllowed, setBaseAllowed, FakeForbidden } = vi.hoisted(() => {
  const store = new Map<string, { value: unknown; updatedAt: Date }>();
  const writeCalls: any[] = [];
  let allowed = new Set<string>();
  let baseAllowed = true;

  class FakeForbidden extends Error {}

  return {
    store,
    writeCalls,
    getAllowed: () => allowed,
    setAllowed: (s: Set<string>) => { allowed = s; },
    getBaseAllowed: () => baseAllowed,
    setBaseAllowed: (v: boolean) => { baseAllowed = v; },
    FakeForbidden,
  };
});

// --- mock repository ---
vi.mock("@/kernel/settings/repository", () => ({
  readRaw: async (key: string) => store.get(key) ?? null,
  writeWithAudit: async (p: any) => {
    writeCalls.push(p);
    const updatedAt = new Date(2026, 0, 2);
    store.set(p.key, { value: p.value, updatedAt });
    // redact를 실제로 호출해 metadata 형태 검증 가능하게 한다
    p._auditMetadata = p.redact(store.get(p.key)?.value, p.value);
    return { updatedAt };
  },
}));

// --- mock access ---
vi.mock("@/kernel/access", () => ({
  ForbiddenError: FakeForbidden,
  requirePermission: async (_u: string, resource: string, action: string) => {
    if (resource === "admin.settings" && action === "view" && !getBaseAllowed()) throw new FakeForbidden();
  },
  hasPermission: async (_u: string, resource: string, action: string) => getAllowed().has(`${resource}:${action}`),
}));

// --- mock env ---
vi.mock("@/lib/env", () => ({
  getSecretStatus: (specs: Array<{ id: string }>) =>
    specs.map((s) => ({ id: s.id, health: s.id === "secret.smtp" ? "configured" : "attention_required" })),
}));

import {
  getSetting,
  setSetting,
  listSettings,
  redactForAudit,
} from "@/kernel/settings/service";
import {
  UnknownSettingError,
  SettingNotWritableError,
  SettingValidationError,
  SettingInvalidError,
  SettingActorRequiredError,
} from "@/kernel/settings/registry";

beforeEach(() => {
  store.clear();
  writeCalls.length = 0;
  setAllowed(new Set());
  setBaseAllowed(true);
});

describe("getSetting", () => {
  it("미등록 key → UnknownSettingError", async () => {
    await expect(getSetting("nope.nope.nope")).rejects.toBeInstanceOf(UnknownSettingError);
  });
  it("row 없음 → default", async () => {
    expect(await getSetting("integrations.smtp.fromAddress")).toBe("");
  });
  it("유효 row → 값", async () => {
    store.set("integrations.smtp.fromAddress", { value: "ops@x.com", updatedAt: new Date() });
    expect(await getSetting("integrations.smtp.fromAddress")).toBe("ops@x.com");
  });
  it("invalid row + fallbackSafe=true → default(no throw)", async () => {
    store.set("workflows.weeklyReport.defaultRecipients", { value: "not-array", updatedAt: new Date() });
    expect(await getSetting("workflows.weeklyReport.defaultRecipients")).toEqual([]);
  });
  it("invalid row + fallbackSafe=false → SettingInvalidError", async () => {
    store.set("integrations.smtp.fromAddress", { value: 123, updatedAt: new Date() });
    await expect(getSetting("integrations.smtp.fromAddress")).rejects.toBeInstanceOf(SettingInvalidError);
  });
});

describe("setSetting", () => {
  it("actorId 누락 → SettingActorRequiredError", async () => {
    await expect(setSetting("integrations.smtp.fromAddress", "x", { actorId: "", expectedUpdatedAt: null })).rejects.toBeInstanceOf(SettingActorRequiredError);
  });
  it("미등록 key → UnknownSettingError", async () => {
    await expect(setSetting("nope.nope.nope", "x", { actorId: "u1", expectedUpdatedAt: null })).rejects.toBeInstanceOf(UnknownSettingError);
  });
  it("envSecret key → SettingNotWritableError", async () => {
    await expect(setSetting("secret.smtp", "x", { actorId: "u1", expectedUpdatedAt: null })).rejects.toBeInstanceOf(SettingNotWritableError);
  });
  it("relational key → SettingNotWritableError", async () => {
    await expect(setSetting("workflows.billing.config", {}, { actorId: "u1", expectedUpdatedAt: null })).rejects.toBeInstanceOf(SettingNotWritableError);
  });
  it("Zod 실패 → SettingValidationError", async () => {
    await expect(setSetting("integrations.smtp.fromAddress", "not-email", { actorId: "u1", expectedUpdatedAt: null })).rejects.toBeInstanceOf(SettingValidationError);
  });
  it("성공 → writeWithAudit 호출(검증된 값·actorId·expectedUpdatedAt·redact 전달)", async () => {
    const at = new Date(2026, 0, 1);
    await setSetting("integrations.smtp.fromAddress", "ops@x.com", { actorId: "u1", expectedUpdatedAt: at });
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]).toMatchObject({ key: "integrations.smtp.fromAddress", value: "ops@x.com", actorId: "u1", expectedUpdatedAt: at });
    expect(typeof writeCalls[0].redact).toBe("function");
  });
});

describe("redactForAudit", () => {
  it("full → before/after 원값", () => {
    expect(redactForAudit("full", "a", "b")).toEqual({ before: "a", after: "b" });
  });
  it("redacted → 값 없음", () => {
    expect(redactForAudit("redacted", "a", "b")).toEqual({ changed: true });
  });
  it("summary 배열 → 원 PII 부재(길이+changed, 역추적 해시 없음)", () => {
    const out: any = redactForAudit("summary", ["a@x.com"], ["a@x.com", "b@y.com"]);
    expect(JSON.stringify(out)).not.toContain("@x.com");
    expect(out.before).toMatchObject({ type: "array", length: 1 });
    expect(out.after).toMatchObject({ type: "array", length: 2 });
    expect(out.changed).toBe(true);
    expect("hash" in out.after).toBe(false);
  });
  it("summary 동일값 재저장 → changed=false", () => {
    expect(redactForAudit("summary", ["a@x.com"], ["a@x.com"])).toMatchObject({ changed: false });
  });
});

describe("listSettings", () => {
  it("admin.settings:view 없으면 base 게이트 throw", async () => {
    setBaseAllowed(false);
    await expect(listSettings("u1")).rejects.toBeInstanceOf(FakeForbidden);
  });
  it("권한 있는 항목만 포함(hasPermission 기준)", async () => {
    setAllowed(new Set(["integrations.smtp:configure"]));
    const items = await listSettings("u1");
    const keys = items.map((i) => i.key);
    expect(keys).toContain("integrations.smtp.fromAddress");
    expect(keys).not.toContain("workflows.weeklyReport.defaultRecipients");
  });
  it("systemSetting status: 유효→OK(value), invalid→INVALID(default)", async () => {
    setAllowed(new Set(["integrations.smtp:configure"]));
    store.set("integrations.smtp.fromAddress", { value: 123, updatedAt: new Date() }); // invalid
    const items = await listSettings("u1");
    const from = items.find((i) => i.key === "integrations.smtp.fromAddress")!;
    expect(from.status).toBe("INVALID");
    expect(from.value).toBe(""); // default
  });
  it("envSecret status=coarse, value 없음", async () => {
    setAllowed(new Set(["integrations.smtp:view"]));
    const items = await listSettings("u1");
    const smtp = items.find((i) => i.key === "secret.smtp")!;
    expect(smtp.status).toBe("configured");
    expect("value" in smtp).toBe(false);
  });
  it("relational status=LINK + manageHref", async () => {
    setAllowed(new Set(["workflows.billing:configure"]));
    const items = await listSettings("u1");
    const billing = items.find((i) => i.key === "workflows.billing.config")!;
    expect(billing.status).toBe("LINK");
    expect(billing.manageHref).toBe("/admin/settings/billing");
  });
});
