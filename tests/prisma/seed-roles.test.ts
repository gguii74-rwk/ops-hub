import { describe, it, expect } from "vitest";
import { ROLE_ALLOW } from "../../prisma/seed-roles";

describe("ROLE_ALLOW 외주 역할 캘린더 권한", () => {
  const contractorRoles = ["contractor-developer", "contractor-content", "contractor-civil-response"];

  it("외주 3역할 모두 calendar.leave:view 보유(§8.1)", () => {
    for (const role of contractorRoles) {
      expect(ROLE_ALLOW[role]).toContain("calendar.leave:view");
    }
  });

  it("외주 역할은 work/personal 캘린더도 유지", () => {
    for (const role of contractorRoles) {
      expect(ROLE_ALLOW[role]).toContain("calendar.work:view");
      expect(ROLE_ALLOW[role]).toContain("calendar.personal:view");
    }
  });

  it("정규 개발자도 calendar.leave:view 유지(회귀 방지)", () => {
    expect(ROLE_ALLOW["regular-developer"]).toContain("calendar.leave:view");
  });
});
