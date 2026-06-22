import { describe, it, expect } from "vitest";
import { STATUS_LABEL, STATUS_VARIANT, EMPLOYMENT_LABEL, JOB_LABEL, SYSTEM_ROLE_LABEL, ROLE_OPTIONS } from "@/app/(app)/admin/users/_components/labels";

describe("user 관리 라벨 상수", () => {
  it("UserStatus 5값이 모두 라벨·variant를 가진다", () => {
    for (const s of ["PENDING", "INVITED", "ACTIVE", "DISABLED", "REJECTED"] as const) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_VARIANT[s]).toBeTruthy();
    }
  });
  it("고용형태·직무·systemRole 라벨이 enum을 덮는다", () => {
    expect(Object.keys(EMPLOYMENT_LABEL)).toEqual(["REGULAR", "CONTRACTOR"]);
    expect(Object.keys(JOB_LABEL)).toEqual(["PM", "DEVELOPER", "CONTENT_MANAGER", "CIVIL_RESPONSE"]);
    expect(Object.keys(SYSTEM_ROLE_LABEL)).toEqual(["OWNER", "ADMIN", "MANAGER", "MEMBER"]);
  });
  it("특권 역할(pm·admin)은 privileged=true로 표시된다", () => {
    const priv = ROLE_OPTIONS.filter((r) => r.privileged).map((r) => r.key).sort();
    expect(priv).toEqual(["admin", "pm"]);
  });
});
