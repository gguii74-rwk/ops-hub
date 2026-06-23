import { describe, it, expect } from "vitest";
import { ROLE_ALLOW, expandRoleCells, OWNER_ONLY_KEYS } from "../../prisma/seed-roles";

describe("ROLE_ALLOW scope-tuple 인코딩(D9)", () => {
  it("현 매트릭스는 non-all scope 셀이 없다(PD2 — team은 편집기로)", () => {
    for (const cells of Object.values(ROLE_ALLOW)) {
      for (const c of cells) {
        if (Array.isArray(c)) expect(c[1]).toBe("all");
      }
    }
  });
  it("pm은 와일드카드(*)", () => { expect(ROLE_ALLOW.pm).toContain("*"); });
  it("위임 admin에 admin.teams/admin.roles:view 포함", () => {
    expect(ROLE_ALLOW.admin).toContain("admin.teams:view");
    expect(ROLE_ALLOW.admin).toContain("admin.teams:configure");
    expect(ROLE_ALLOW.admin).toContain("admin.roles:view");
  });
});

describe("expandRoleCells — OWNER 전용 키 제외(F-L)", () => {
  // admin.roles:configure를 포함한 전체 키 집합으로 와일드카드를 확장해도 OWNER 전용 키는 빠져야 한다.
  const allKeys = ["leave.approval:view", "leave.approval:approve", "admin.teams:configure", "admin.roles:view", "admin.roles:configure"];
  it("pm '*' 확장이 admin.roles:configure를 부여하지 않는다(D7 불변식)", () => {
    const cells = expandRoleCells(["*"], allKeys);
    expect(cells.map(([k]) => k)).not.toContain("admin.roles:configure");
    expect(cells.map(([k]) => k)).toContain("admin.teams:configure"); // 다른 키는 정상 포함
  });
  it("명시 항목 경로도 OWNER 전용 키를 제외", () => {
    expect(expandRoleCells(["admin.roles:configure", "admin.roles:view"], allKeys).map(([k]) => k)).toEqual(["admin.roles:view"]);
  });
  it("어떤 ROLE_ALLOW 역할도 확장 후 OWNER 전용 키를 받지 않는다", () => {
    for (const cells of Object.values(ROLE_ALLOW)) {
      const expanded = expandRoleCells(cells, allKeys).map(([k]) => k);
      for (const owned of OWNER_ONLY_KEYS) expect(expanded).not.toContain(owned);
    }
  });
});
