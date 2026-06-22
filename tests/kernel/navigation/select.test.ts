import { describe, it, expect } from "vitest";
import { selectVisibleNav, type RawNavParent } from "@/kernel/navigation";

const perm = (resource: string, action = "view") => ({ resource, action });

function parent(over: Partial<RawNavParent> & { key: string; sortOrder: number }): RawNavParent {
  return {
    label: over.key, href: `/${over.key}`, requiredPermission: null, children: [],
    ...over,
  };
}

describe("selectVisibleNav (D4 관용 가시성)", () => {
  it("공개 부모(권한 null)는 자식 없어도 노출", () => {
    const out = selectVisibleNav([parent({ key: "dash", sortOrder: 10 })], new Set());
    expect(out).toEqual([{ key: "dash", label: "dash", href: "/dash", children: [] }]);
  });

  it("부모 권한 실패 + 보이는 자식 있으면 부모 노출하되 href=null(그룹 토글 — D5 인코딩)", () => {
    const tree: RawNavParent[] = [parent({
      key: "admin", sortOrder: 50, href: "/admin", requiredPermission: perm("admin.users"),
      children: [
        { key: "nav", label: "메뉴", href: "/admin/navigation", sortOrder: 10, requiredPermission: perm("admin.navigation") },
      ],
    })];
    const out = selectVisibleNav(tree, new Set(["admin.navigation:view"])); // 부모 권한 없음, 자식 권한 있음
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "admin", href: null }); // 자체 권한 실패 → 링크 아님
    expect(out[0].children.map((c) => c.key)).toEqual(["nav"]);
  });

  it("부모 권한 통과 + 자식 전부 실패면 부모 링크(href 유지) + 자식 빈 배열", () => {
    const tree: RawNavParent[] = [parent({
      key: "admin", sortOrder: 50, href: "/admin", requiredPermission: perm("admin.users"),
      children: [{ key: "nav", label: "메뉴", href: "/x", sortOrder: 10, requiredPermission: perm("admin.navigation") }],
    })];
    const out = selectVisibleNav(tree, new Set(["admin.users:view"]));
    expect(out).toHaveLength(1);
    expect(out[0].href).toBe("/admin"); // 자체 권한 통과 → 링크 유지
    expect(out[0].children).toEqual([]);
  });

  it("빈 부모 숨김: 부모 권한 실패 + 보이는 자식 0 → 제외", () => {
    const tree: RawNavParent[] = [parent({
      key: "admin", sortOrder: 50, requiredPermission: perm("admin.users"),
      children: [{ key: "nav", label: "메뉴", href: "/x", sortOrder: 10, requiredPermission: perm("admin.navigation") }],
    })];
    const out = selectVisibleNav(tree, new Set()); // 아무 권한 없음
    expect(out).toEqual([]);
  });

  it("부모·자식 모두 sortOrder로 정렬", () => {
    const tree: RawNavParent[] = [
      parent({ key: "b", sortOrder: 20 }),
      parent({
        key: "a", sortOrder: 10, children: [
          { key: "c2", label: "c2", href: "/c2", sortOrder: 20, requiredPermission: null },
          { key: "c1", label: "c1", href: "/c1", sortOrder: 10, requiredPermission: null },
        ],
      }),
    ];
    const out = selectVisibleNav(tree, new Set());
    expect(out.map((n) => n.key)).toEqual(["a", "b"]);
    expect(out[0].children.map((c) => c.key)).toEqual(["c1", "c2"]);
  });
});
