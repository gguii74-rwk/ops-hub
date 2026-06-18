import { describe, it, expect } from "vitest";
import { CATALOG, getEntry, SYSTEM_KEYS } from "@/kernel/settings/catalog";
import type { SettingEntry } from "@/kernel/settings/registry";

const KEY_GRAMMAR = /^[a-z]+(\.[a-zA-Z]+)+$/; // <module>.<feature>.<setting>

describe("settings catalog 정합성", () => {
  it("모든 엔트리에 key·category·order·title·description·permission 존재", () => {
    for (const e of CATALOG) {
      expect(e.key, `${e.key} key`).toBeTruthy();
      expect(["security", "integrations", "workflows", "general"]).toContain(e.category);
      expect(typeof e.order).toBe("number");
      expect(e.title).toBeTruthy();
      expect(e.description).toBeTruthy();
      expect(e.permission.resource, `${e.key} resource`).toBeTruthy();
      expect(e.permission.action, `${e.key} action`).toBeTruthy();
    }
  });

  it("key는 카탈로그 내 유일", () => {
    const keys = CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("systemSetting 엔트리는 key 문법·schema·default·audit·fallbackSafe 보유", () => {
    const sys = CATALOG.filter((e): e is Extract<SettingEntry, { kind: "systemSetting" }> => e.kind === "systemSetting");
    expect(sys.length).toBeGreaterThan(0);
    for (const e of sys) {
      expect(e.key, `${e.key} grammar`).toMatch(KEY_GRAMMAR);
      expect(e.schema).toBeTruthy();
      expect(e.default !== undefined, `${e.key} default`).toBe(true);
      expect(["full", "redacted", "summary"]).toContain(e.audit);
      expect(typeof e.fallbackSafe).toBe("boolean");
    }
  });

  it("systemSetting default는 자신의 schema를 통과", () => {
    for (const e of CATALOG) {
      if (e.kind !== "systemSetting") continue;
      expect(e.schema.safeParse(e.default).success, `${e.key} default valid`).toBe(true);
    }
  });

  it("SYSTEM_KEYS는 systemSetting 키 집합과 일치", () => {
    const sys = CATALOG.filter((e) => e.kind === "systemSetting").map((e) => e.key);
    expect([...SYSTEM_KEYS].sort()).toEqual(sys.sort());
  });

  it("systemSetting key 집합과 envSecret envVars 이름 집합은 무교집합", () => {
    const sysKeys = new Set(CATALOG.filter((e) => e.kind === "systemSetting").map((e) => e.key));
    const envNames = new Set(
      CATALOG.flatMap((e) => (e.kind === "envSecret" ? e.envVars.map((v) => v.name) : [])),
    );
    for (const n of envNames) expect(sysKeys.has(n), `${n} overlaps systemSetting key`).toBe(false);
  });

  it("getEntry는 등록 key를 찾고 미등록은 undefined", () => {
    expect(getEntry("integrations.smtp.host")?.kind).toBe("systemSetting");
    expect(getEntry("nope.nope.nope")).toBeUndefined();
  });

  it("카탈로그 항목 수 고정 (5 systemSetting, 5 envSecret, 1 relational)", () => {
    const byKind = (k: string) => CATALOG.filter((e) => e.kind === k).length;
    expect(byKind("systemSetting")).toBe(5);
    expect(byKind("envSecret")).toBe(5);
    expect(byKind("relational")).toBe(1);
    expect(CATALOG.length).toBe(11);
  });
});
