import { describe, expect, it } from "vitest";
import {
  NON_PRIVILEGED_ROLE_KEYS,
  PRIVILEGED_SYSTEM_ROLES,
  CRITICAL_RESOURCE_PREFIXES,
  USER_MGMT_PERMISSION,
  AUDIT_PERMISSION,
  isPrivilegedRoleKey,
} from "@/modules/admin/users/policy";

describe("policy 상수", () => {
  it("비특권 역할 키 allowlist는 개발/외주 4종 (D13ⓑ·finding I)", () => {
    expect([...NON_PRIVILEGED_ROLE_KEYS]).toEqual([
      "regular-developer", "contractor-developer", "contractor-content", "contractor-civil-response",
    ]);
  });
  it("특권 systemRole은 OWNER·ADMIN (D12)", () => {
    expect([...PRIVILEGED_SYSTEM_ROLES]).toEqual(["OWNER", "ADMIN"]);
  });
  it("critical prefix는 admin. (D13ⓓ)", () => {
    expect([...CRITICAL_RESOURCE_PREFIXES]).toEqual(["admin."]);
  });
  it("최소가용성 권한 키 (D13ⓔ)", () => {
    expect(USER_MGMT_PERMISSION).toBe("admin.users:update");
    expect(AUDIT_PERMISSION).toBe("admin.audit:view");
  });
});

describe("isPrivilegedRoleKey (sync, fail-closed — 비특권 allowlist 반전, finding I)", () => {
  it("개발/외주 4종만 비특권", () => {
    expect(isPrivilegedRoleKey("regular-developer")).toBe(false);
    expect(isPrivilegedRoleKey("contractor-developer")).toBe(false);
    expect(isPrivilegedRoleKey("contractor-content")).toBe(false);
    expect(isPrivilegedRoleKey("contractor-civil-response")).toBe(false);
  });
  it("pm·admin은 특권", () => {
    expect(isPrivilegedRoleKey("pm")).toBe(true);
    expect(isPrivilegedRoleKey("admin")).toBe(true);
  });
  it("미지의 키는 **특권**(fail-closed — finding I, 이전 fail-open 반전)", () => {
    expect(isPrivilegedRoleKey("unknown")).toBe(true);
  });
  it("다른 키로 admin 권한을 묶은 seeded/import/future 역할도 특권(비특권 allowlist에 없음)", () => {
    // 예: 카탈로그 외 키 'superadmin'·'auditor' 등 — admin.* 권한 보유 여부와 무관하게 allowlist에 없으면 특권으로 보호.
    expect(isPrivilegedRoleKey("superadmin")).toBe(true);
    expect(isPrivilegedRoleKey("auditor")).toBe(true);
  });
});
