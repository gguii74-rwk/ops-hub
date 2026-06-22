import { describe, it, expect, vi, beforeEach } from "vitest";

const repo = vi.hoisted(() => ({
  getNavigationTree: vi.fn(), createItem: vi.fn(), updateItem: vi.fn(),
  reorderSiblings: vi.fn(), reparentItem: vi.fn(), cascadeDelete: vi.fn(),
  getNodeForDelete: vi.fn(), rolesGrantingPermission: vi.fn(), listSelectablePermissions: vi.fn(),
}));
const requirePermissionMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/admin/navigation/repositories", () => repo);
vi.mock("@/kernel/access", () => ({ requirePermission: requirePermissionMock }));

import {
  createNavigationItem, updateNavigationItem, deleteNavigationItem,
  reparentNavigationItem, reorderNavigationItems, previewRoles,
} from "@/modules/admin/navigation/services";
import { NavigationConflictError } from "@/modules/admin/navigation/errors";

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(undefined);
});

// audit는 repo가 in-tx로 기록(P1) — 서비스 책임 아님. 서비스 테스트는 게이트·actorId 전달·캡처만 검증.
describe("navigation services — 게이트·actorId 전달", () => {
  it("create: configure 게이트 → createItem(input, actorId)", async () => {
    repo.createItem.mockResolvedValue({ id: "n1" });
    const input = { label: "메뉴", href: "/x", parentId: null, requiredPermissionId: null };
    const out = await createNavigationItem("admin1", input);
    expect(requirePermissionMock).toHaveBeenCalledWith("admin1", "admin.navigation", "configure");
    expect(repo.createItem).toHaveBeenCalledWith(input, "admin1");
    expect(out).toEqual({ id: "n1" });
  });

  it("권한 거부 시 repo 미호출", async () => {
    requirePermissionMock.mockRejectedValue(new Error("forbidden"));
    await expect(createNavigationItem("u", { label: "x", href: null, parentId: null, requiredPermissionId: null })).rejects.toThrow();
    expect(repo.createItem).not.toHaveBeenCalled();
  });

  it("update: 게이트 → updateItem(id, patch, expectedUpdatedAt, actorId)", async () => {
    const at = new Date("2026-06-22T00:00:00Z");
    await updateNavigationItem("admin1", "n1", { label: "새이름" }, at);
    expect(requirePermissionMock).toHaveBeenCalledWith("admin1", "admin.navigation", "configure");
    expect(repo.updateItem).toHaveBeenCalledWith("n1", { label: "새이름" }, at, "admin1");
  });

  it("update: 권한 거부 시 repo 미호출", async () => {
    requirePermissionMock.mockRejectedValue(new Error("forbidden"));
    const at = new Date("2026-06-22T00:00:00Z");
    await expect(updateNavigationItem("u", "n1", { label: "x" }, at)).rejects.toThrow();
    expect(repo.updateItem).not.toHaveBeenCalled();
  });

  it("delete: 확인 집합 일치 → 캡처 자식으로 cascadeDelete(input, actorId)", async () => {
    const at = new Date("2026-06-22T00:00:00Z");
    repo.getNodeForDelete.mockResolvedValue({ children: [{ id: "c1", updatedAt: at }] });
    await deleteNavigationItem("admin1", "p1", at, ["c1"]);
    expect(requirePermissionMock).toHaveBeenCalledWith("admin1", "admin.navigation", "configure");
    expect(repo.cascadeDelete).toHaveBeenCalledWith(
      { parentId: "p1", parentUpdatedAt: at, children: [{ id: "c1", updatedAt: at }] },
      "admin1",
    );
  });

  it("delete: 권한 거부 시 repo 미호출", async () => {
    requirePermissionMock.mockRejectedValue(new Error("forbidden"));
    const at = new Date("2026-06-22T00:00:00Z");
    await expect(deleteNavigationItem("u", "p1", at, [])).rejects.toThrow();
    expect(repo.getNodeForDelete).not.toHaveBeenCalled();
    expect(repo.cascadeDelete).not.toHaveBeenCalled();
  });

  it("delete(P9): 확인 후 추가된 자식(DB 집합≠확인 집합) → Conflict, cascade 미호출(TOCTOU 오삭제 차단)", async () => {
    const at = new Date("2026-06-22T00:00:00Z");
    // 확인 화면엔 c1만 보였는데 캡처 시점 DB엔 c1,c2(렌더 후 c2 추가) — 그대로 삭제하면 c2가 확인 없이 휩쓸린다.
    repo.getNodeForDelete.mockResolvedValue({ children: [{ id: "c1", updatedAt: at }, { id: "c2", updatedAt: at }] });
    await expect(deleteNavigationItem("admin1", "p1", at, ["c1"])).rejects.toBeInstanceOf(NavigationConflictError);
    expect(repo.cascadeDelete).not.toHaveBeenCalled();
  });

  it("delete: 노드 없으면 Conflict(cascade 미호출)", async () => {
    repo.getNodeForDelete.mockResolvedValue(null);
    await expect(deleteNavigationItem("admin1", "x", new Date(), [])).rejects.toBeInstanceOf(NavigationConflictError);
    expect(repo.cascadeDelete).not.toHaveBeenCalled();
  });

  it("reparent: 게이트 → reparentItem({id,newParentId,expectedUpdatedAt}, actorId)", async () => {
    const at = new Date("2026-06-22T00:00:00Z");
    await reparentNavigationItem("admin1", "a", "b", at);
    expect(requirePermissionMock).toHaveBeenCalledWith("admin1", "admin.navigation", "configure");
    expect(repo.reparentItem).toHaveBeenCalledWith({ id: "a", newParentId: "b", expectedUpdatedAt: at }, "admin1");
  });

  it("reparent: 권한 거부 시 repo 미호출", async () => {
    requirePermissionMock.mockRejectedValue(new Error("forbidden"));
    const at = new Date("2026-06-22T00:00:00Z");
    await expect(reparentNavigationItem("u", "a", "b", at)).rejects.toThrow();
    expect(repo.reparentItem).not.toHaveBeenCalled();
  });

  it("reorder: 게이트 → reorderSiblings(input, actorId)", async () => {
    const at = new Date("2026-06-22T00:00:00Z");
    const input = { parentId: null, orderedItems: [{ id: "a", updatedAt: at }, { id: "b", updatedAt: at }] };
    await reorderNavigationItems("admin1", input);
    expect(requirePermissionMock).toHaveBeenCalledWith("admin1", "admin.navigation", "configure");
    expect(repo.reorderSiblings).toHaveBeenCalledWith(input, "admin1");
  });

  it("reorder: 권한 거부 시 repo 미호출", async () => {
    requirePermissionMock.mockRejectedValue(new Error("forbidden"));
    const at = new Date("2026-06-22T00:00:00Z");
    const input = { parentId: null, orderedItems: [{ id: "a", updatedAt: at }] };
    await expect(reorderNavigationItems("u", input)).rejects.toThrow();
    expect(repo.reorderSiblings).not.toHaveBeenCalled();
  });

  it("previewRoles: 읽기 — 서비스 게이트 없이 위임(라우트가 view 게이트)", async () => {
    repo.rolesGrantingPermission.mockResolvedValue([{ key: "admin", name: "관리자" }]);
    const out = await previewRoles("p1");
    expect(requirePermissionMock).not.toHaveBeenCalled();
    expect(out).toEqual([{ key: "admin", name: "관리자" }]);
  });
});
