export const RESOURCES = [
  "dashboard",
  "calendar.work", "calendar.leave", "calendar.personal", "calendar.team", "calendar.admin",
  "workflows", "workflows.weekly", "workflows.billing", "workflows.notification",
  "workflows.weeklyClient", "workflows.monthlyClient", "workflows.mail",
  "leave.request", "leave.approval", "leave.allocation", "leave.status", "leave.admin",
  "admin.users", "admin.settings", "admin.audit", "admin.navigation", "admin.teams", "admin.roles",
  "integrations.google", "integrations.smtp", "integrations.templates",
] as const;

export const ACTIONS = [
  "view", "create", "update", "delete", "approve", "cancel",
  "generate", "review", "send", "configure", "export", "impersonate",
] as const;

export const ACCESS_ROLE_KEYS = [
  "pm",
  "admin",
  "regular-developer",
  "contractor-developer",
  "contractor-content",
  "contractor-civil-response",
] as const;

export type AccessRoleKey = (typeof ACCESS_ROLE_KEYS)[number];

export interface NavEntry {
  key: string;
  label: string;
  href: string;
  permission: string; // "resource:action"
  children?: readonly NavEntry[]; // 2단 부트스트랩 자식(이후 DB가 진실원 — D3)
}

// 초기 부트스트랩 시드 데이터. seed.ts가 create-if-absent로 1회 적재하며(task-03),
// 이후 메뉴의 진실원은 DB다(관리 UI에서 편집 — D3). 코드에서 여기를 바꿔도 기존 DB엔 반영되지 않는다(의도).
export const NAV: readonly NavEntry[] = [
  { key: "dashboard", label: "대시보드", href: "/dashboard", permission: "dashboard:view" },
  { key: "calendar", label: "캘린더", href: "/calendar", permission: "calendar.work:view" },
  {
    key: "workflows", label: "업무", href: "/workflows", permission: "workflows:view",
    children: [
      // index 자식: 부모(업무) 클릭 시 캘린더로. label rename(D11)·게이팅=집계 workflows:view(D13).
      { key: "workflows-list", label: "캘린더", href: "/workflows", permission: "workflows:view" },
      { key: "workflows-billing-settings", label: "대금청구 설정", href: "/workflows/billing/settings", permission: "workflows.billing:configure" },
    ],
  },
  {
    key: "leave", label: "연차", href: "/leave", permission: "leave.request:view",
    children: [
      { key: "leave-dashboard", label: "대시보드", href: "/leave", permission: "leave.request:view" },
      { key: "leave-request", label: "연차 신청", href: "/leave/request", permission: "leave.request:create" },
      { key: "leave-calendar", label: "캘린더", href: "/leave/calendar", permission: "leave.request:view" },
      { key: "leave-history", label: "연차 내역", href: "/leave/history", permission: "leave.request:view" },
      { key: "leave-manage", label: "연차 관리", href: "/leave/manage", permission: "leave.approval:view" },
    ],
  },
  {
    key: "admin", label: "관리", href: "/admin", permission: "admin.users:view",
    children: [
      { key: "admin-users", label: "사용자 관리", href: "/admin/users", permission: "admin.users:view" },
      { key: "admin-teams", label: "팀 관리", href: "/admin/teams", permission: "admin.teams:view" },
      { key: "admin-roles", label: "권한 매트릭스", href: "/admin/roles", permission: "admin.roles:view" },
      { key: "admin-navigation", label: "메뉴 관리", href: "/admin/navigation", permission: "admin.navigation:view" },
      { key: "admin-settings", label: "설정", href: "/admin/settings", permission: "admin.settings:view" },
    ],
  },
] as const;

// 권한 매트릭스 묶음 부여·표시 그룹 — resource 첫 세그먼트 단위(D3). 순서=표시 순서(메뉴와 동일).
export const PERMISSION_GROUPS = [
  { key: "dashboard", label: "대시보드" },
  { key: "calendar", label: "캘린더" },
  { key: "workflows", label: "업무" },
  { key: "leave", label: "연차" },
  { key: "admin", label: "관리" },
  { key: "integrations", label: "연동" },
] as const;
export const PERMISSION_GROUP_KEYS = PERMISSION_GROUPS.map((g) => g.key);

// 권한 매트릭스 역할 열 표시 순서(UX 전용, D1). 시드·타입용 ACCESS_ROLE_KEYS와 분리.
export const ROLE_DISPLAY_ORDER = [
  "admin", "pm", "regular-developer",
  "contractor-developer", "contractor-content", "contractor-civil-response",
] as const;
