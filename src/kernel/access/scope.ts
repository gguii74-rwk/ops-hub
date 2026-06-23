import type { PermissionRule } from "@/kernel/access/decision";

export type EnforceableScope = "own" | "team" | "all"; // assigned 제외(D13 — 미해석)
export const SCOPE_RANK: Record<EnforceableScope, number> = { all: 3, team: 2, own: 1 };

const ALL_ENFORCEABLE: readonly EnforceableScope[] = ["own", "team", "all"];

// ALLOW 중 가장 넓은 enforceable scope. assigned는 후보에서 제외(F1: 미해석 scope가 좁은 유효 grant 가림 방지).
// `allowed`로 후보를 clamp한다(PD2/F-A): resource가 허용하지 않는 scope의 ALLOW는 후보에서 제외 — 비-scopeable resource에
// team/own override가 걸려도 enforceable 후보가 되지 못해 effective scope가 null/all로만 나온다(아래 effectiveScope 주석).
function widestEnforceable(rules: PermissionRule[], allowed: readonly EnforceableScope[]): EnforceableScope | null {
  let best: EnforceableScope | null = null;
  for (const r of rules) {
    if (r.effect !== "ALLOW") continue;
    if (r.scope === "assigned") continue;
    const s = r.scope as EnforceableScope;
    if (!allowed.includes(s)) continue; // PD2/F-A clamp — 비허용 scope는 후보 제외
    if (best === null || SCOPE_RANK[s] > SCOPE_RANK[best]) best = s;
  }
  return best;
}

// computeDecision 우선순위의 scope 일반화(OWNER/게이트는 index.ts가 prisma 컨텍스트로 처리).
// override DENY → null / override ALLOW(enforceable∩allowed) → 최광 / role DENY → null / role ALLOW(enforceable∩allowed) → 최광 / else null.
// `allowed`(기본 무제약)는 소비처가 allowedScopes(resource)를 주입한다(F-A): 비-scopeable resource는 ["all"]이라
// team/own ALLOW가 clamp돼 그 grant만 있으면 null(메뉴 미노출), all ALLOW가 있으면 all(정상). DENY는 scope-무관 거부(불변).
export function effectiveScope(
  input: { overrides: PermissionRule[]; roleRules: PermissionRule[] },
  allowed: readonly EnforceableScope[] = ALL_ENFORCEABLE,
): EnforceableScope | null {
  if (input.overrides.some((r) => r.effect === "DENY")) return null;
  const ovrAllow = widestEnforceable(input.overrides, allowed);
  if (ovrAllow) return ovrAllow;
  if (input.roleRules.some((r) => r.effect === "DENY")) return null;
  const roleAllow = widestEnforceable(input.roleRules, allowed);
  if (roleAllow) return roleAllow;
  return null;
}

// PD2 — 편집기·부트스트랩·업그레이드 마이그레이션·**엔진(getEffectiveScope/getPermissionSummary)** 공유 SSOT.
// 본 증분에서 scope-aware 소비처가 있는 resource만 team/own을 연다. 엔진이 이 집합으로 clamp하므로(F-A),
// override-panel(증분 ①) 등이 비-scopeable resource에 team/own override를 만들어도 메뉴/데이터로 새지 않는다(fail-closed).
export const SCOPEABLE_RESOURCES: Record<string, EnforceableScope[]> = {
  "leave.approval": ["all", "team"],
};
export function allowedScopes(resource: string): EnforceableScope[] {
  return SCOPEABLE_RESOURCES[resource] ?? ["all"];
}
