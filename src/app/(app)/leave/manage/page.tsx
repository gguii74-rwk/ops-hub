import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { PageSection } from "@/components/ui/page-section";
import { EmptyState } from "@/components/ui/states";
import { ApprovalsClient } from "./approvals-client";

export default async function ApprovalsPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const canView = new Set(keys).has("leave.approval:view");
  return (
    <PageSection title="연차 승인">
      {!canView ? <EmptyState>승인 권한이 없습니다.</EmptyState> : <ApprovalsClient />}
    </PageSection>
  );
}
