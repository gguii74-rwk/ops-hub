import type { EmploymentType, JobFunction, SystemRole } from "@/lib/auth/types";
import type { ChipTone } from "@/components/ui/chip";

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
// MANAGER 폐지(미사용 coarse 등급) — 부여 드롭다운에서 제외해 신규 부여를 막는다.
// SYSTEM_ROLE_LABEL엔 MANAGER를 남겨 둔다(기존 MANAGER 사용자 표시가 깨지지 않도록).
export const SYSTEM_ROLE_OPTIONS = ["OWNER", "ADMIN", "MEMBER"] as SystemRole[];

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

// ── 컬러톤 매핑(Aurora 컬러칩, task-04 소비). 값=ChipTone. ──
export const STATUS_TONE: Record<UserStatusKey, ChipTone> = {
  PENDING: "amber",
  INVITED: "blue",
  ACTIVE: "ok",
  DISABLED: "off",
  REJECTED: "rose",
};
export const EMPLOYMENT_TONE: Record<EmploymentType, ChipTone> = {
  REGULAR: "blue",
  CONTRACTOR: "amber",
};
export const JOB_TONE: Record<JobFunction, ChipTone> = {
  PM: "pink",
  DEVELOPER: "blue",
  CONTENT_MANAGER: "purple",
  CIVIL_RESPONSE: "orange",
};

// raw 역할 key → 한글 표시명(ROLE_OPTIONS 단일 출처에서 파생).
export const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((o) => [o.key, o.label]),
);
// 역할 key → 컬러톤. 직무 도메인 색을 따른다(개발=blue·콘텐츠=purple·민원=orange), 특권은 pink/rose.
export const ROLE_TONE: Record<string, ChipTone> = {
  pm: "pink",
  admin: "rose",
  "regular-developer": "blue",
  "contractor-developer": "blue",
  "contractor-content": "purple",
  "contractor-civil-response": "orange",
};

export function roleLabel(key: string): string {
  return ROLE_LABEL[key] ?? key;
}
export function roleTone(key: string): ChipTone {
  return ROLE_TONE[key] ?? "neutral";
}
