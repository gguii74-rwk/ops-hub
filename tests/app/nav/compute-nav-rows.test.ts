import { describe, it, expect } from "vitest";
import { computeNavRows, isActiveHref } from "@/app/(app)/app-nav";

type NavItem = { key: string; label: string; href: string | null; children: NavItem[] };
const leaf = (key: string, href: string | null): NavItem => ({ key, label: key, href, children: [] });

describe("isActiveHref", () => {
  it("정확 일치·하위 경로는 active, null·무관 경로는 아님", () => {
    expect(isActiveHref("/admin", "/admin")).toBe(true);
    expect(isActiveHref("/admin", "/admin/navigation")).toBe(true);
    expect(isActiveHref("/admin", "/dashboard")).toBe(false);
    expect(isActiveHref(null, "/admin")).toBe(false);
    expect(isActiveHref("/admin", "/administrators")).toBe(false); // prefix 오탐 방지(슬래시 경계)
  });
});

describe("computeNavRows (D5 링크/토글·자동펼침)", () => {
  const items: NavItem[] = [
    leaf("dashboard", "/dashboard"),
    { key: "admin", label: "관리", href: null, children: [leaf("admin-navigation", "/admin/navigation")] }, // 토글 부모
    { key: "leave", label: "연차", href: "/leave", children: [leaf("leave-status", "/leave/status")] },     // 링크 부모
  ];

  it("href 있는 노드는 링크, null이면 토글", () => {
    const rows = computeNavRows(items, "/dashboard");
    expect(rows.find((r) => r.key === "dashboard")!.isLink).toBe(true);
    expect(rows.find((r) => r.key === "admin")!.isLink).toBe(false);
    expect(rows.find((r) => r.key === "leave")!.isLink).toBe(true);
  });

  it("현재 경로가 자식이면 부모 active + 자동 펼침, 자식 active 표시", () => {
    const rows = computeNavRows(items, "/admin/navigation");
    const admin = rows.find((r) => r.key === "admin")!;
    expect(admin.active).toBe(true);
    expect(admin.autoExpanded).toBe(true);
    expect(admin.children.find((c) => c.key === "admin-navigation")!.active).toBe(true);
  });

  it("무관 경로면 부모 비활성·미펼침", () => {
    const rows = computeNavRows(items, "/dashboard");
    const admin = rows.find((r) => r.key === "admin")!;
    expect(admin.active).toBe(false);
    expect(admin.autoExpanded).toBe(false);
  });
});
