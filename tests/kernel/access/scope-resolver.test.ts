import { describe, it, expect } from "vitest";
import { effectiveScope, allowedScopes, SCOPE_RANK } from "@/kernel/access/scope";
import type { PermissionRule } from "@/kernel/access/decision";

const allow = (scope: PermissionRule["scope"]): PermissionRule => ({ effect: "ALLOW", scope });
const deny = (scope: PermissionRule["scope"]): PermissionRule => ({ effect: "DENY", scope });

describe("effectiveScope (computeDecision 우선순위의 scope 일반화)", () => {
  it("override DENY → null(scope 무관 거부)", () => {
    expect(effectiveScope({ overrides: [deny("all"), allow("all")], roleRules: [allow("all")] })).toBeNull();
  });
  it("override ALLOW가 role DENY를 이긴다(override 티어 우선)", () => {
    expect(effectiveScope({ overrides: [allow("team")], roleRules: [deny("all")] })).toBe("team");
  });
  it("role DENY가 role ALLOW를 이긴다", () => {
    expect(effectiveScope({ overrides: [], roleRules: [deny("all"), allow("team")] })).toBeNull();
  });
  it("ALLOW 중 가장 넓은 enforceable scope를 고른다(all>team>own)", () => {
    expect(effectiveScope({ overrides: [], roleRules: [allow("own"), allow("team")] })).toBe("team");
    expect(effectiveScope({ overrides: [], roleRules: [allow("team"), allow("all")] })).toBe("all");
  });
  // F1 — assigned는 미해석이라 ALLOW 후보에서 제외돼 더 좁은 유효 grant를 가리지 않는다.
  it("assigned는 own/team을 가리지 않는다", () => {
    expect(effectiveScope({ overrides: [], roleRules: [allow("assigned"), allow("own")] })).toBe("own");
    expect(effectiveScope({ overrides: [], roleRules: [allow("assigned"), allow("team")] })).toBe("team");
  });
  it("assigned 단독은 null(미허가, fail-closed)", () => {
    expect(effectiveScope({ overrides: [], roleRules: [allow("assigned")] })).toBeNull();
  });
  it("아무것도 없으면 null(fail-closed)", () => {
    expect(effectiveScope({ overrides: [], roleRules: [] })).toBeNull();
  });
  // F-A — allowed clamp: 비-scopeable resource(["all"])는 team/own ALLOW를 후보에서 제외.
  it("clamp: 비-scopeable resource(allowed=[all])에 team override만 있으면 null(노출 차단)", () => {
    expect(effectiveScope({ overrides: [allow("team")], roleRules: [] }, ["all"])).toBeNull();
    expect(effectiveScope({ overrides: [allow("own")], roleRules: [] }, ["all"])).toBeNull();
  });
  it("clamp: 비-scopeable resource라도 all ALLOW는 통과(정상 admin 권한)", () => {
    expect(effectiveScope({ overrides: [], roleRules: [allow("all")] }, ["all"])).toBe("all");
  });
  it("clamp: scopeable resource(allowed=[all,team])는 team ALLOW를 그대로 인정", () => {
    expect(effectiveScope({ overrides: [], roleRules: [allow("team")] }, ["all", "team"])).toBe("team");
  });
});

describe("allowedScopes (PD2 — scopeable resource)", () => {
  it("leave.approval만 team을 연다", () => {
    expect(allowedScopes("leave.approval")).toEqual(["all", "team"]);
  });
  it("그 외는 all-only(F5 — 비-scope-aware 소비처 보호)", () => {
    expect(allowedScopes("calendar.work")).toEqual(["all"]);
    expect(allowedScopes("calendar.leave")).toEqual(["all"]);
    expect(allowedScopes("workflows.billing")).toEqual(["all"]);
    expect(allowedScopes("admin.users")).toEqual(["all"]);
  });
  it("SCOPE_RANK은 all>team>own", () => {
    expect(SCOPE_RANK.all).toBeGreaterThan(SCOPE_RANK.team);
    expect(SCOPE_RANK.team).toBeGreaterThan(SCOPE_RANK.own);
  });
});
