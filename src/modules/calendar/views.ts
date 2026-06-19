import type { ViewKey } from "./types";

export const VIEW_PERMISSION: Record<ViewKey, string> = {
  work: "calendar.work",
  leave: "calendar.leave",
  personal: "calendar.personal",
  team: "calendar.team",
  admin: "calendar.admin",
};

export const UI_VIEWS: ViewKey[] = ["work", "leave", "personal"];

export const VIEW_SOURCES: Record<ViewKey, string[]> = {
  work: ["workflowTask", "internalLeave", "holiday"],
  leave: ["internalLeave", "google", "holiday"],
  personal: ["internalLeave", "manual", "google", "holiday"], // workflowTask 제외(사용자 귀속 없는 조직 일정). feed가 본인 소유+공휴일만 통과(§9 personal 스코프)
  team: ["workflowTask", "internalLeave", "holiday"],
  admin: ["internalLeave", "workflowTask", "manual", "google", "holiday"],
};

export function isViewKey(v: string): v is ViewKey {
  return v === "work" || v === "leave" || v === "personal" || v === "team" || v === "admin";
}
