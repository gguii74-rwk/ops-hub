import type { EmploymentType, JobFunction, SystemRole } from "@/lib/auth/types";

export type UserStatusKey = "PENDING" | "INVITED" | "ACTIVE" | "DISABLED" | "REJECTED";

export const STATUS_LABEL: Record<UserStatusKey, string> = {
  PENDING: "승인 대기",
  INVITED: "초대됨",
  ACTIVE: "활성",
  DISABLED: "비활성",
  REJECTED: "거절됨",
};
export const STATUS_VARIANT: Record<UserStatusKey, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "secondary",
  INVITED: "outline",
  ACTIVE: "default",
  DISABLED: "outline",
  REJECTED: "destructive",
};

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  REGULAR: "정규직",
  CONTRACTOR: "외주",
};
export const JOB_LABEL: Record<JobFunction, string> = {
  PM: "PM",
  DEVELOPER: "개발",
  CONTENT_MANAGER: "콘텐츠",
  CIVIL_RESPONSE: "민원대응",
};
export const SYSTEM_ROLE_LABEL: Record<SystemRole, string> = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  MEMBER: "MEMBER",
};

export const EMPLOYMENT_OPTIONS = Object.keys(EMPLOYMENT_LABEL) as EmploymentType[];
export const JOB_OPTIONS = Object.keys(JOB_LABEL) as JobFunction[];
export const SYSTEM_ROLE_OPTIONS = Object.keys(SYSTEM_ROLE_LABEL) as SystemRole[];

export const ROLE_OPTIONS: Array<{ key: string; label: string; privileged: boolean }> = [
  { key: "regular-developer", label: "정규 개발자", privileged: false },
  { key: "contractor-developer", label: "외주 개발자", privileged: false },
  { key: "contractor-content", label: "외주 콘텐츠", privileged: false },
  { key: "contractor-civil-response", label: "외주 민원대응", privileged: false },
  { key: "pm", label: "PM(전체권한)", privileged: true },
  { key: "admin", label: "사용자 관리자", privileged: true },
];

export const SCOPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "전체(all) — ALLOW는 이 값만 전역 허용" },
  { value: "own", label: "본인(own)" },
  { value: "team", label: "팀(team) — ②증분 전까지 미작동" },
  { value: "assigned", label: "배정(assigned)" },
];
