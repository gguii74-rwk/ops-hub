import type { SessionUser } from "@/lib/auth/types";

export interface Identity {
  sub: string;
  email: string;
  groups: string[];
}

/** claims 생성에 필요한 최소 필드. 세션·DB row 어느 쪽이든 충족하면 된다. */
export type ClaimsSource = Pick<SessionUser, "id" | "email" | "systemRole">;

/** coarse groups 매핑(spec §8). 모든 인증 사용자 + systemRole별 가산. */
export function toGroups(user: ClaimsSource): string[] {
  const groups = ["kgs-user"];
  if (user.systemRole === "OWNER" || user.systemRole === "ADMIN") groups.push("ops-admin");
  // MANAGER 폐지(미사용 coarse 등급) — ops-manager 그룹 미발급.
  return groups;
}

/** 외부에 넘기는 "최소 신원". 출력 모양(sub/email/groups)이 A→B 전환의 안정 계약. */
export function issueClaims(user: ClaimsSource): Identity {
  return { sub: user.id, email: user.email, groups: toGroups(user) };
}
