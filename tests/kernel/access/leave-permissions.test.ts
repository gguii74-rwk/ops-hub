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
  it("작업자 role에 관리자 전용 키 없음", () => {
    const adminKeys = ["leave.approval:approve", "leave.allocation:configure", "leave.request:update", "leave.request:delete"];
    for (const role of ["regular-developer", "contractor-developer", "contractor-content", "contractor-civil-response"]) {
      for (const key of adminKeys) {
        expect(ROLE_ALLOW[role]).not.toContain(key);
      }
    }
  });
  it("기존 leave 권한 키 보존", () => {
    expect(hasExtra("leave.request", "create")).toBe(true);
    expect(hasExtra("leave.approval", "approve")).toBe(true);
    expect(hasExtra("leave.allocation", "configure")).toBe(true);
  });
});
