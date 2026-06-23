import { describe, it, expect } from "vitest";
import { RESOURCES, NAV } from "@/kernel/access/catalog";

describe("admin.teams 카탈로그·nav (D11)", () => {
  it("RESOURCES에 admin.teams 포함", () => {
    expect(RESOURCES).toContain("admin.teams");
  });
  it("NAV admin 트리에 admin-teams(/admin/teams, admin.teams:view)", () => {
    const admin = NAV.find((n) => n.key === "admin");
    const teams = admin?.children?.find((c) => c.key === "admin-teams");
    expect(teams).toMatchObject({ href: "/admin/teams", permission: "admin.teams:view" });
  });
});
