import { describe, it, expect } from "vitest";
import { RESOURCES, NAV } from "@/kernel/access/catalog";
import { EXTRA_PERMISSIONS } from "../../../prisma/seed-permissions";
import { ROLE_ALLOW } from "../../../prisma/seed-roles";

describe("admin.navigation 권한 카탈로그(D14)", () => {
  it("RESOURCES에 admin.navigation(→ :view 자동 seed)", () => {
    expect(RESOURCES).toContain("admin.navigation");
  });
  it("EXTRA_PERMISSIONS에 [admin.navigation, configure]", () => {
    expect(EXTRA_PERMISSIONS).toContainEqual(["admin.navigation", "configure"]);
  });
  it("admin 역할이 view·configure 둘 다 ALLOW(OWNER는 자동)", () => {
    expect(ROLE_ALLOW.admin).toContain("admin.navigation:view");
    expect(ROLE_ALLOW.admin).toContain("admin.navigation:configure");
  });
});

describe("NAV 부트스트랩 트리(D3/D14)", () => {
  it("기존 5개 대메뉴 보존", () => {
    expect(NAV.map((n) => n.key)).toEqual(["dashboard", "calendar", "workflows", "leave", "admin"]);
  });
  it("관리 대메뉴에 메뉴 관리 자식(href·permission)", () => {
    const admin = NAV.find((n) => n.key === "admin");
    expect(admin?.children).toBeDefined();
    const navItem = admin!.children!.find((c) => c.key === "admin-navigation");
    expect(navItem).toMatchObject({
      key: "admin-navigation",
      label: "메뉴 관리",
      href: "/admin/navigation",
      permission: "admin.navigation:view",
    });
  });
});
