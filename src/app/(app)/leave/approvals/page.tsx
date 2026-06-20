import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { ApprovalsClient } from "./approvals-client";

export default async function ApprovalsPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const canView = new Set(keys).has("leave.approval:view");
  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">연차 승인</h1>
      {!canView ? <p className="text-sm text-muted-foreground">승인 권한이 없습니다.</p> : <ApprovalsClient />}
    </section>
  );
}
