import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { KIND_RESOURCE } from "@/modules/workflows/policy";
import type { WorkflowKind } from "@prisma/client";
import { WorkflowsList } from "./workflows-list";

const KINDS: WorkflowKind[] = ["WEEKLY_REPORT", "BILLING", "NOTIFICATION_BILLING"];

export default async function WorkflowsPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const keySet = new Set(keys);
  const allowed = KINDS.filter((k) => keySet.has(`${KIND_RESOURCE[k]}:view`));

  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">업무</h1>
      {allowed.length === 0 ? (
        <p className="text-sm text-muted-foreground">열람 권한이 있는 업무가 없습니다.</p>
      ) : (
        <WorkflowsList />
      )}
    </section>
  );
}
