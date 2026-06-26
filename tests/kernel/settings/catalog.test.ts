import { describe, it, expect } from "vitest";
import { CATALOG, getEntry, SYSTEM_KEYS } from "@/kernel/settings/catalog";
import type { SettingEntry } from "@/kernel/settings/registry";

const KEY_GRAMMAR = /^[a-z]+(\.[a-zA-Z]+)+$/; // <module>.<feature>.<setting>

describe("settings catalog 정합성", () => {
  it("모든 엔트리에 key·category·order·title·description·permission 존재", () => {
    for (const e of CATALOG) {
      expect(e.key, `${e.key} key`).toBeTruthy();
      expect(["security", "integrations", "workflows", "leave", "general"]).toContain(e.category);
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
    expect(getEntry("integrations.smtp.fromAddress")?.kind).toBe("systemSetting");
    expect(getEntry("nope.nope.nope")).toBeUndefined();
  });

  it("카탈로그 항목 수 고정 (6 systemSetting, 5 envSecret, 1 relational)", () => {
    const byKind = (k: string) => CATALOG.filter((e) => e.kind === k).length;
    expect(byKind("systemSetting")).toBe(6); // host·port 제거 후(fromAddress·calendarIds·defaultRecipients·onRequest·onApprove·onReject)
    expect(byKind("envSecret")).toBe(5);
    expect(byKind("relational")).toBe(1);
    expect(CATALOG.length).toBe(12);
  });

  it("SMTP host·port systemSetting은 제거됨(env 전용 — host=F4, port=P3/A2), secure/user 미추가", () => {
    expect(getEntry("integrations.smtp.host")).toBeUndefined();
    expect(getEntry("integrations.smtp.port")).toBeUndefined();
    expect(getEntry("integrations.smtp.secure")).toBeUndefined();
    expect(getEntry("integrations.smtp.user")).toBeUndefined();
    // DB 편집 가능한 SMTP 필드는 fromAddress 하나뿐
    expect(getEntry("integrations.smtp.fromAddress")?.kind).toBe("systemSetting");
  });

  it("calendarIds는 systemSetting 유지(PR-A relational 전환 안 함)", () => {
    const e = getEntry("integrations.google.calendarIds");
    expect(e?.kind).toBe("systemSetting");
  });

  it("모든 엔트리에 group(6종)·groupOrder(number) 존재", () => {
    const groups = ["security", "mail", "google", "documents", "leave", "workflows"];
    for (const e of CATALOG) {
      expect(groups, `${e.key} group`).toContain(e.group);
      expect(typeof e.groupOrder, `${e.key} groupOrder`).toBe("number");
    }
  });

  it("그룹별 groupOrder는 유일(같은 group 내 중복 없음)", () => {
    const byGroup = new Map<string, number[]>();
    for (const e of CATALOG) {
      const arr = byGroup.get(e.group) ?? [];
      arr.push(e.groupOrder);
      byGroup.set(e.group, arr);
    }
    for (const [g, orders] of byGroup) {
      expect(new Set(orders).size, `${g} groupOrder unique`).toBe(orders.length);
    }
  });

  it("leave 알림 3키 — category=leave·default true·z.boolean·leave.admin:configure·audit full", () => {
    const keys = [
      "leave.notifications.onRequest",
      "leave.notifications.onApprove",
      "leave.notifications.onReject",
    ];
    for (const key of keys) {
      const e = getEntry(key);
      expect(e, `${key} 존재`).toBeDefined();
      expect(e!.kind).toBe("systemSetting");
      expect(e!.category).toBe("leave");
      expect(e!.permission).toEqual({ resource: "leave.admin", action: "configure" }); // D6 도메인 스코프
      if (e!.kind !== "systemSetting") throw new Error("unreachable");
      expect(e!.default).toBe(true);
      expect(e!.audit).toBe("full"); // E: OFF/ON 방향 감사 기록
      expect(e!.fallbackSafe).toBe(true);
      // z.boolean(): true/false 통과, 비boolean reject
      expect(e!.schema.safeParse(true).success).toBe(true);
      expect(e!.schema.safeParse(false).success).toBe(true);
      expect(e!.schema.safeParse("true").success).toBe(false);
      expect(e!.schema.safeParse(1).success).toBe(false);
    }
  });
});
