import { describe, expect, it } from "vitest";
import { computeDecision } from "@/kernel/access/decision";
import type { PermissionRule } from "@/kernel/access/decision";

const allow: PermissionRule = { effect: "ALLOW", scope: "all" };
const deny: PermissionRule = { effect: "DENY", scope: "all" };

describe("computeDecision (deny-priority, fail-closed)", () => {
  it("OWNER allows regardless of any rule", () => {
    expect(computeDecision({ isOwner: true, overrides: [deny], roleRules: [deny] })).toBe(true);
  });

  it("override DENY beats override ALLOW and any role rule", () => {
    expect(computeDecision({ isOwner: false, overrides: [deny, allow], roleRules: [allow] })).toBe(false);
  });

  it("override ALLOW beats role DENY", () => {
    expect(computeDecision({ isOwner: false, overrides: [allow], roleRules: [deny] })).toBe(true);
  });

  it("role DENY beats role ALLOW", () => {
    expect(computeDecision({ isOwner: false, overrides: [], roleRules: [deny, allow] })).toBe(false);
  });

  it("role ALLOW allows when no denies", () => {
    expect(computeDecision({ isOwner: false, overrides: [], roleRules: [allow] })).toBe(true);
  });

  it("treats non-all-scope ALLOW as no global grant (fail-closed, no escalation)", () => {
    const teamAllow: PermissionRule = { effect: "ALLOW", scope: "team" };
    expect(computeDecision({ isOwner: false, overrides: [], roleRules: [teamAllow] })).toBe(false);
    expect(computeDecision({ isOwner: false, overrides: [teamAllow], roleRules: [] })).toBe(false);
  });

  it("defaults to deny when nothing matches (fail-closed)", () => {
    expect(computeDecision({ isOwner: false, overrides: [], roleRules: [] })).toBe(false);
  });
});
