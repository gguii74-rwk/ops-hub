import { describe, it, expect } from "vitest";
import { ACCESS_ROLE_KEYS, RESOURCES, ACTIONS } from "@/kernel/access/catalog";
import { EXTRA_PERMISSIONS } from "../../../prisma/seed-permissions";
import { ROLE_ALLOW } from "../../../prisma/seed-roles";

const hasExtra = (r: string, a: string) => EXTRA_PERMISSIONS.some(([res, act]) => res === r && act === a);
const ADMIN_ROLE = [
  "admin.users:view", "admin.users:create", "admin.users:update", "admin.users:approve",
  "admin.settings:configure", "admin.audit:view",
];

describe("user-management catalog·seed (task-01)", () => {
  it("ACCESS_ROLE_KEYS에 admin 추가", () => {
    expect(ACCESS_ROLE_KEYS).toContain("admin");
  });

  it("catalog RESOURCES/ACTIONS는 이미 admin 권한을 표현 가능(변경 없음)", () => {
    expect(RESOURCES).toContain("admin.users");
    expect(RESOURCES).toContain("admin.audit");
    expect(ACTIONS).toContain("create");
    expect(ACTIONS).toContain("approve");
    expect(ACTIONS).toContain("update");
  });

  it("EXTRA_PERMISSIONS에 admin.users:create·approve·admin.audit:view 추가", () => {
    expect(hasExtra("admin.users", "create")).toBe(true);
    expect(hasExtra("admin.users", "approve")).toBe(true);
    expect(hasExtra("admin.audit", "view")).toBe(true);
  });

  it("admin.users:update는 이미 존재(보존)", () => {
    expect(hasExtra("admin.users", "update")).toBe(true);
  });

  it("ROLE_ALLOW.admin이 D8 권한 묶음을 정확히 보유", () => {
    expect(ROLE_ALLOW.admin).toBeDefined();
    expect(ROLE_ALLOW.admin).toEqual(ADMIN_ROLE);
  });

  it("pm은 전체(\"*\") 유지(회귀 방지)", () => {
    expect(ROLE_ALLOW.pm).toEqual(["*"]);
  });
});
