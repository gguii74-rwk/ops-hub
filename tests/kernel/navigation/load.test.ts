import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const db = { navigationItem: { findMany: vi.fn() } };
  return { db, prisma: db };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { loadNavigation } from "@/kernel/navigation";

beforeEach(() => vi.clearAllMocks());

describe("loadNavigation (트리 쿼리 + 위임)", () => {
  it("활성 최상위 + 활성 children을 로드하고 권한 필터를 적용", async () => {
    h.db.navigationItem.findMany.mockResolvedValue([
      {
        key: "admin", label: "관리", href: "/admin", sortOrder: 50,
        requiredPermission: { resource: "admin.users", action: "view" },
        children: [
          { key: "nav", label: "메뉴 관리", href: "/admin/navigation", sortOrder: 10, requiredPermission: { resource: "admin.navigation", action: "view" } },
        ],
      },
    ]);
    const out = await loadNavigation(["admin.navigation:view"]); // 부모 권한 없음 → 관용 노출 + href=null
    expect(out).toEqual([
      { key: "admin", label: "관리", href: null, children: [
        { key: "nav", label: "메뉴 관리", href: "/admin/navigation", children: [] },
      ] },
    ]);
    const arg = h.db.navigationItem.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ isActive: true, parentId: null });
    expect(arg.select.children.where).toEqual({ isActive: true });
  });
});
