import type { SessionUser } from "@/lib/auth/types";

export interface Identity {
  sub: string;
  email: string;
  groups: string[];
}

/** coarse groups 매핑(spec §8). 모든 인증 사용자 + systemRole별 가산. */
export function toGroups(user: SessionUser): string[] {
  const groups = ["kgs-user"];
  if (user.systemRole === "OWNER" || user.systemRole === "ADMIN") groups.push("ops-admin");
  if (user.systemRole === "MANAGER") groups.push("ops-manager");
  return groups;
}

/** 외부에 넘기는 "최소 신원". 출력 모양(sub/email/groups)이 A→B 전환의 안정 계약. */
export function issueClaims(user: SessionUser): Identity {
  return { sub: user.id, email: user.email, groups: toGroups(user) };
}
