import { describe, it, expect } from "vitest";
import { NAV, RESOURCES, ACTIONS, type NavEntry } from "@/kernel/access/catalog";

const byKey = (entries: readonly NavEntry[], key: string) => {
  const found = entries.find((e) => e.key === key);
  if (!found) throw new Error(`NAV에 '${key}' 없음`);
  return found;
};

describe("NAV 카탈로그 트리 구조", () => {
  it("연차(leave) 자식 5개 — 순서·href·권한 고정", () => {
    const leave = byKey(NAV, "leave");
    expect(leave.href).toBe("/leave");
    expect(leave.permission).toBe("leave.request:view");
    expect((leave.children ?? []).map((c) => [c.key, c.href, c.permission])).toEqual([
      ["leave-dashboard", "/leave", "leave.request:view"],
      ["leave-request", "/leave/request", "leave.request:create"],
      ["leave-calendar", "/leave/calendar", "leave.request:view"],
      ["leave-history", "/leave/history", "leave.request:view"],
      ["leave-manage", "/leave/manage", "leave.approval:view"],
    ]);
  });

  it("관리(admin) 자식 5개 — 사용자·팀·권한·메뉴·설정 순서", () => {
    const admin = byKey(NAV, "admin");
    expect((admin.children ?? []).map((c) => [c.key, c.href, c.permission])).toEqual([
      ["admin-users", "/admin/users", "admin.users:view"],
      ["admin-teams", "/admin/teams", "admin.teams:view"],
      ["admin-roles", "/admin/roles", "admin.roles:view"],
      ["admin-navigation", "/admin/navigation", "admin.navigation:view"],
      ["admin-settings", "/admin/settings", "admin.settings:view"],
    ]);
  });

  it("모든 NAV 권한 키가 카탈로그(RESOURCES×ACTIONS)에 존재 — 새 권한 없음", () => {
    const resources = new Set<string>(RESOURCES);
    const actions = new Set<string>(ACTIONS);
    const walk = (entries: readonly NavEntry[]): void => {
      for (const e of entries) {
        const [resource, action] = e.permission.split(":");
        expect(resources.has(resource), `resource '${resource}'`).toBe(true);
        expect(actions.has(action), `action '${action}'`).toBe(true);
        if (e.children?.length) walk(e.children);
      }
    };
    walk(NAV);
  });

  it("깊이 2단 — 자식의 자식 없음", () => {
    for (const top of NAV) {
      for (const child of top.children ?? []) {
        expect(child.children ?? [], `${child.key}는 leaf여야 함`).toHaveLength(0);
      }
    }
  });
});
