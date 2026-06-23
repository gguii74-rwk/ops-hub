import { describe, it, expect } from "vitest";
import { RESOURCES, NAV } from "@/kernel/access/catalog";

describe("admin.roles 카탈로그·nav (D11)", () => {
  it("RESOURCES에 admin.roles 포함", () => { expect(RESOURCES).toContain("admin.roles"); });
  it("NAV admin 트리에 admin-roles(/admin/roles, admin.roles:view)", () => {
    const teams = NAV.find((n) => n.key === "admin")?.children?.find((c) => c.key === "admin-roles");
    expect(teams).toMatchObject({ href: "/admin/roles", permission: "admin.roles:view" });
  });
});
