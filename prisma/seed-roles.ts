// role → 허용 "resource:action" 키. 명확한 셀만(ALLOW). "제한"은 미포함 → 거부 유지.
// seed.ts가 import한다. 외주 역할의 calendar.leave:view는 Phase 3 §8.1에서 추가됨
// (외주 인력이 휴가 신청 당사자이자 cutover 주 사용자 — workspace-env INVENTORY §1.5).
export const ROLE_ALLOW: Record<string, string[]> = {
  // pm 권한은 OWNER systemRole로 전부 허용되지만, 비-OWNER PM 대비 명시 ALLOW도 부여.
  pm: ["*"],
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
