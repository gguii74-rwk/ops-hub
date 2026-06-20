export type Action =
  | "view" | "create" | "update" | "delete" | "approve" | "cancel"
  | "generate" | "review" | "send" | "configure" | "export" | "impersonate";

export type Scope = "own" | "team" | "assigned" | "all";

export interface PermissionRule {
  effect: "ALLOW" | "DENY";
  scope: Scope;
}

export interface DecisionInput {
  isOwner: boolean;
  overrides: PermissionRule[];
  roleRules: PermissionRule[];
}

/**
 * 권한 결정(컨텍스트 없는 전역 검사). 우선순위(ADR-0002):
 * OWNER → override DENY → override ALLOW → role DENY → role ALLOW → 기본 거부(fail-closed).
 * ALLOW는 scope="all"만 허가로 인정한다. own/team/assigned는 target 컨텍스트 없이 평가 불가 →
 * 전역 검사에선 허가로 치지 않는다(스코프 ALLOW의 전역 누수 차단). DENY는 스코프 무관 거부(보수적).
 */
export function computeDecision(input: DecisionInput): boolean {
  if (input.isOwner) return true;
  if (input.overrides.some((r) => r.effect === "DENY")) return false;
  if (input.overrides.some((r) => r.effect === "ALLOW" && r.scope === "all")) return true;
  if (input.roleRules.some((r) => r.effect === "DENY")) return false;
  if (input.roleRules.some((r) => r.effect === "ALLOW" && r.scope === "all")) return true;
  return false;
}

export function permissionKey(resource: string, action: string): string {
  return `${resource}:${action}`;
}
