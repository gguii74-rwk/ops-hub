import { describe, it, expect, vi } from "vitest";
import { applyWorkflowsNavReconcile } from "../../prisma/migrate-helpers/workflows-nav-reconcile";

function mkDb(flagExists: boolean) {
  return {
    systemSetting: { findUnique: vi.fn(async () => (flagExists ? { key: "x" } : null)), create: vi.fn(async () => ({})) },
    navigationItem: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
}

describe("applyWorkflowsNavReconcile (D11·D13 — 기존 nav flip)", () => {
  it("workflows 부모(권한만)·workflows-list 자식(label+권한) 교정 + 플래그", async () => {
    const db = mkDb(false);
    const r = await applyWorkflowsNavReconcile(db as never, "perm-agg");
    expect(r.applied).toBe(true);
    const calls = db.navigationItem.updateMany.mock.calls.map((c: any) => c[0]);
    // 부모: 권한만
    expect(calls).toContainEqual({ where: { key: "workflows" }, data: { requiredPermissionId: "perm-agg" } });
    // 자식: label "캘린더" + 권한
    expect(calls).toContainEqual({ where: { key: "workflows-list" }, data: { label: "캘린더", requiredPermissionId: "perm-agg" } });
    expect(db.systemSetting.create).toHaveBeenCalled();
  });

  it("플래그 있으면 no-op(admin CMS 라벨 편집 보존)", async () => {
    const db = mkDb(true);
    const r = await applyWorkflowsNavReconcile(db as never, "perm-agg");
    expect(r.applied).toBe(false);
    expect(db.navigationItem.updateMany).not.toHaveBeenCalled();
  });

  it("workflows:view 권한 id 없음 → throw + 플래그 미설정", async () => {
    const db = mkDb(false);
    await expect(applyWorkflowsNavReconcile(db as never, undefined)).rejects.toThrow(/workflows:view/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });
});
