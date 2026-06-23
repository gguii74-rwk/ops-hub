// role → 허용 "resource:action" 키. 명확한 셀만(ALLOW). "제한"은 미포함 → 거부 유지.
// seed.ts가 import한다. 외주 역할의 calendar.leave:view는 Phase 3 §8.1에서 추가됨
// (외주 인력이 휴가 신청 당사자이자 cutover 주 사용자 — workspace-env INVENTORY §1.5).

// 셀 scope 인코딩(D9): "key" = scope "all", ["key","team"] = team scope. 현 매트릭스엔 non-all 셀이 없다(PD2 —
// team-scope 승인은 "제한"=미부여, OWNER가 편집기로 leave.approval team 부여). tuple은 *능력*만 추가.
export type Cell = string | [string, "own" | "team" | "all"];
export const ROLE_ALLOW: Record<string, Cell[]> = {
  // pm 권한은 OWNER systemRole로 전부 허용되지만, 비-OWNER PM 대비 명시 ALLOW도 부여.
  pm: ["*"],
  // 위임 사용자 관리자(D8) — OWNER 없이 사용자관리를 위임. pm/admin 특권 부여는 서비스 가드(D12/D13)가 OWNER-only로 제한.
  admin: [
    "admin.users:view", "admin.users:create", "admin.users:update", "admin.users:approve",
    "admin.settings:configure", "admin.audit:view",
    "admin.navigation:view", "admin.navigation:configure",
    "admin.teams:view", "admin.teams:configure",
    "admin.roles:view",
  ],
  "regular-developer": [
    "dashboard:view", "calendar.work:view", "calendar.leave:view", "calendar.personal:view",
    "calendar.team:view", "workflows.weekly:view", "workflows.billing:view",
    "workflows.notification:view", "leave.request:view",
    "leave.request:create", "leave.request:cancel", "workflows.weekly:create", "workflows.weekly:generate",
    "workflows.notification:create",
  ],
  "contractor-developer": [
    "dashboard:view", "calendar.work:view", "calendar.leave:view", "calendar.personal:view",
    "workflows.weekly:view", "workflows.notification:view", "leave.request:view",
    "leave.request:create", "leave.request:cancel", "workflows.weekly:create", "workflows.notification:create",
  ],
  "contractor-content": [
    "dashboard:view", "calendar.work:view", "calendar.leave:view", "calendar.personal:view",
    "workflows.weekly:view", "workflows.notification:view", "leave.request:view",
    "leave.request:create", "leave.request:cancel", "workflows.weekly:create", "workflows.notification:create",
  ],
  "contractor-civil-response": [
    "dashboard:view", "calendar.work:view", "calendar.leave:view", "calendar.personal:view",
    "workflows.notification:view", "leave.request:view",
    "leave.request:create", "leave.request:cancel", "workflows.notification:create",
  ],
};

// OWNER systemRole 전용 — 어떤 AccessRole에도 시드 안 함(D7). pm "*" 와일드카드 확장에서도 제외(F-L: 안 그러면 pm이 god-power).
export const OWNER_ONLY_KEYS: readonly string[] = ["admin.roles:configure"];

// 한 역할의 ROLE_ALLOW 항목을 (key, scope)[] 셀로 확장. "*"=allKeys 전체(OWNER 전용 키 제외), 그 외는 명시 항목.
// 두 경로 모두 OWNER_ONLY_KEYS를 최종 제외 — fresh seed가 OWNER 전용 권한을 어떤 역할에도 주지 않음(D7 불변식).
export function expandRoleCells(wanted: Cell[], allKeys: string[]): Array<readonly [string, "own" | "team" | "all"]> {
  const base = wanted.includes("*")
    ? allKeys.map((key) => [key, "all"] as const)
    : wanted.map((c) => (Array.isArray(c) ? [c[0], c[1]] as const : [c, "all"] as const));
  return base.filter(([key]) => !OWNER_ONLY_KEYS.includes(key)); // F-L 제외
}
