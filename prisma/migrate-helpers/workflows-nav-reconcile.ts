// nav rename(D11) + 게이팅 flip(D13). seedNavigation은 편집보존(create-if-absent)이라 기존 nav 행을 갱신하지 않는다.
// 이 헬퍼가 기존 DB의 workflows 부모·workflows-list 자식을 1회 교정: 자식 label("업무 목록"→"캘린더") + 두 행 requiredPermissionId(→workflows:view).
// flag로 1회 보장(이후 admin이 CMS로 라벨 자유 편집 — re-clobber 방지). applyWorkflowsViewUpgrade **이후** 실행(grant 먼저, R5·F1).
export interface WorkflowsNavReconcileClient {
  systemSetting: {
    findUnique(a: { where: { key: string } }): Promise<{ key: string } | null>;
    create(a: { data: { key: string; value: unknown } }): Promise<unknown>;
  };
  navigationItem: {
    updateMany(a: { where: { key: string }; data: { label?: string; requiredPermissionId: string } }): Promise<{ count: number }>;
  };
}

export const WORKFLOWS_NAV_RECONCILE_FLAG = "migration.workflows-nav.reconcile.applied";

// workflowsViewPermissionId: seed의 permissionIdByKey.get("workflows:view"). 없으면 throw(fail-closed — 공개 누출 방지).
export async function applyWorkflowsNavReconcile(
  db: WorkflowsNavReconcileClient,
  workflowsViewPermissionId: string | undefined,
): Promise<{ applied: boolean }> {
  const already = await db.systemSetting.findUnique({ where: { key: WORKFLOWS_NAV_RECONCILE_FLAG } });
  if (already) return { applied: false };
  if (!workflowsViewPermissionId) {
    throw new Error("workflows-nav-reconcile: 'workflows:view' 권한 미존재 — 플래그 미설정, 재시도");
  }
  // 부모 workflows: 권한만 flip(label "업무" 유지). 자식 workflows-list: label→"캘린더" + 권한 flip.
  await db.navigationItem.updateMany({ where: { key: "workflows" }, data: { requiredPermissionId: workflowsViewPermissionId } });
  await db.navigationItem.updateMany({ where: { key: "workflows-list" }, data: { label: "캘린더", requiredPermissionId: workflowsViewPermissionId } });
  await db.systemSetting.create({ data: { key: WORKFLOWS_NAV_RECONCILE_FLAG, value: { appliedAt: "bootstrap" } } });
  return { applied: true };
}
