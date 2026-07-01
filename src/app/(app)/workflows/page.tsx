import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { KIND_RESOURCE } from "@/modules/workflows/policy";
import type { WorkflowKind } from "@prisma/client";
import { PageSection } from "@/components/ui/page-section";
import { EmptyState } from "@/components/ui/states";
import { WorkflowsView } from "./workflows-view";

// F1: enum-파생(하드코딩 배열 금지 — 신규 kind 자동 포함).
const KINDS = Object.keys(KIND_RESOURCE) as WorkflowKind[];

export default async function WorkflowsPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const keySet = new Set(keys);
  // page shell은 per-kind view로 EmptyState 판정 유지(D13: 집계 grant와 동기 보장).
  const allowed = KINDS.filter((k) => keySet.has(`${KIND_RESOURCE[k]}:view`));

  return (
    <PageSection title="업무">
      {allowed.length === 0 ? (
        <EmptyState>열람 권한이 있는 업무가 없습니다.</EmptyState>
      ) : (
        <WorkflowsView />
      )}
    </PageSection>
  );
}
