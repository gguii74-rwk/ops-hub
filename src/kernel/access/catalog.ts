export const RESOURCES = [
  "dashboard",
  "calendar.work", "calendar.leave", "calendar.personal", "calendar.team", "calendar.admin",
  "workflows.weekly", "workflows.billing", "workflows.notification",
  "leave.request", "leave.approval", "leave.allocation", "leave.status", "leave.admin",
  "admin.users", "admin.settings", "admin.audit",
  "integrations.google", "integrations.smtp", "integrations.templates",
] as const;

export const ACTIONS = [
  "view", "create", "update", "delete", "approve", "cancel",
  "generate", "review", "send", "configure", "export", "impersonate",
] as const;

export const ACCESS_ROLE_KEYS = [
  "pm",
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
}

export const NAV: readonly NavEntry[] = [
  { key: "dashboard", label: "대시보드", href: "/dashboard", permission: "dashboard:view" },
  { key: "calendar", label: "캘린더", href: "/calendar", permission: "calendar.work:view" },
  { key: "workflows", label: "업무", href: "/workflows", permission: "workflows.weekly:view" },
  { key: "leave", label: "연차", href: "/leave", permission: "leave.request:view" },
  { key: "admin", label: "관리", href: "/admin", permission: "admin.users:view" },
] as const;
