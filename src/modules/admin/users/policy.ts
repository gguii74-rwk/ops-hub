// 위임 admin(비-OWNER)이 자유롭게 부여/회수할 수 있는 **비특권** 역할 키 allowlist(seed 고정 — 개발/외주 4종). spec D13ⓑ·finding I.
// 이 4종은 `prisma/seed-roles.ts`상 admin.*·"*" 권한이 전혀 없음이 보장된다(under-classify 위험 없음).
export const NON_PRIVILEGED_ROLE_KEYS = [
  "regular-developer", "contractor-developer", "contractor-content", "contractor-civil-response",
] as const;

// OWNER-only 로 부여 가능한 특권 systemRole. spec D12.
export const PRIVILEGED_SYSTEM_ROLES = ["OWNER", "ADMIN"] as const;

// 위임 admin이 타인에게 override(ALLOW·DENY 무관)를 걸 수 없는 critical 리소스 prefix(OWNER-only). spec D13ⓓ.
export const CRITICAL_RESOURCE_PREFIXES = ["admin."] as const;

// "가용 user-management 관리자"로 인정하는 권한 키 (최소 1명 보존). spec D13ⓔ.
export const USER_MGMT_PERMISSION = "admin.users:update";
// "가용 감사 조회자"로 인정하는 권한 키 (최소 1명 보존). spec D13ⓔ.
export const AUDIT_PERMISSION = "admin.audit:view";

// 역할 키가 특권인지 판정 — **fail-closed**(finding I). 비특권 allowlist에 없으면 특권으로 본다(DB 조회 없음·sync).
// pm·admin뿐 아니라 다른 키로 admin.* 권한을 묶은 seeded/import/future 역할, 미지의 키까지 모두 특권으로 보호한다.
// (이전 `PRIVILEGED_ROLE_KEYS=["pm","admin"]` 화이트리스트는 그 밖의 admin-bearing 역할을 비특권으로 흘리는 fail-open이었다.)
export function isPrivilegedRoleKey(key: string): boolean {
  return !(NON_PRIVILEGED_ROLE_KEYS as readonly string[]).includes(key);
}
