import { describe, it, expect, vi } from "vitest";
import { seedNavigation, type NavWriteClient } from "../../prisma/seed-navigation";
import type { NavEntry } from "@/kernel/access/catalog";

function makeClient(existingKeys: Set<string>) {
  const created: Array<Record<string, unknown>> = [];
  let counter = 0;
  const client: NavWriteClient = {
    navigationItem: {
      findUnique: vi.fn(async ({ where }) =>
        existingKeys.has(where.key) ? { id: `exist-${where.key}`, parentId: null } : null,
      ),
      create: vi.fn(async ({ data }) => {
        created.push(data as Record<string, unknown>);
        return { id: `new-${++counter}` };
      }),
    },
  };
  return { client, created };
}

const tree: NavEntry[] = [
  {
    key: "admin", label: "관리", href: "/admin", permission: "admin.users:view",
    children: [
      { key: "admin-navigation", label: "메뉴 관리", href: "/admin/navigation", permission: "admin.navigation:view" },
    ],
  },
];

const resolveAll = async (k: string) =>
  ({ "admin.users:view": "p-users", "admin.navigation:view": "p-nav" } as Record<string, string>)[k] ?? null;

describe("seedNavigation (create-if-absent 트리)", () => {
  it("빈 DB: 부모(parentId null) + 자식(parentId=부모 새 id)을 생성", async () => {
    const { client, created } = makeClient(new Set());
    await seedNavigation(client, tree, resolveAll);
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      key: "admin", parentId: null, requiredPermissionId: "p-users", sortOrder: 10, href: "/admin",
    });
    expect(created[1]).toMatchObject({
      key: "admin-navigation", parentId: "new-1", requiredPermissionId: "p-nav", sortOrder: 10,
    });
  });

  it("부모 존재 시 부모 skip, 자식은 기존 부모 id로 생성(편집 보존 + 신규 자식)", async () => {
    const { client, created } = makeClient(new Set(["admin"]));
    await seedNavigation(client, tree, resolveAll);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ key: "admin-navigation", parentId: "exist-admin" });
  });

  it("전부 존재 시 아무것도 생성하지 않음(전 필드 보존)", async () => {
    const { client, created } = makeClient(new Set(["admin", "admin-navigation"]));
    await seedNavigation(client, tree, resolveAll);
    expect(created).toHaveLength(0);
  });

  it("권한 미해석이면 throw(fail-closed) — 그 항목은 생성되지 않음", async () => {
    const { client, created } = makeClient(new Set(["admin"])); // 부모는 존재 → 자식만 시도
    const resolveNone = async () => null;
    await expect(seedNavigation(client, tree, resolveNone)).rejects.toThrow(/admin-navigation/);
    expect(created).toHaveLength(0);
  });

  it("P7: 자식을 가질 기존 부모가 top-level이 아니면 throw(depth-3 방지, 자식 생성 안 함)", async () => {
    const created: Array<Record<string, unknown>> = [];
    const client: NavWriteClient = {
      navigationItem: {
        // 기존 'admin'이 reparent되어 parentId != null
        findUnique: vi.fn(async () => ({ id: "exist-admin", parentId: "someParent" })),
        create: vi.fn(async ({ data }) => { created.push(data as Record<string, unknown>); return { id: "x" }; }),
      },
    };
    await expect(seedNavigation(client, tree, resolveAll)).rejects.toThrow(/top-level/);
    expect(created).toHaveLength(0);
  });
});
