import { describe, it, expect } from "vitest";
import { ACTIONS } from "@/kernel/access/catalog";
import { EXTRA_PERMISSIONS } from "../../../prisma/seed-permissions";
import { ROLE_ALLOW } from "../../../prisma/seed-roles";

const hasExtra = (r: string, a: string) => EXTRA_PERMISSIONS.some(([res, act]) => res === r && act === a);

describe("leave 권한", () => {
  it("ACTIONS에 cancel 추가", () => {
    expect(ACTIONS).toContain("cancel");
  });
  it("EXTRA_PERMISSIONS에 leave 관리 키", () => {
    expect(hasExtra("leave.request", "cancel")).toBe(true);
    expect(hasExtra("leave.request", "update")).toBe(true);
    expect(hasExtra("leave.request", "delete")).toBe(true);
    expect(hasExtra("leave.approval", "view")).toBe(true);
    expect(hasExtra("leave.allocation", "view")).toBe(true);
  });
  it("작업자 role 전원이 leave.request:cancel 보유", () => {
    for (const key of ["regular-developer", "contractor-developer", "contractor-content", "contractor-civil-response"]) {
      expect(ROLE_ALLOW[key]).toContain("leave.request:cancel");
      expect(ROLE_ALLOW[key]).toContain("leave.request:create");
    }
  });
});
