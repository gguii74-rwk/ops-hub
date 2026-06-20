import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { HistoryClient } from "../_components/history-client";

export default async function LeaveHistoryPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const set = new Set(keys);
  if (!set.has("leave.request:view"))
    return <p className="text-sm text-muted-foreground">연차 내역 권한이 없습니다.</p>;
  return (
    <HistoryClient
      canAdminView={set.has("leave.admin:view")}
      canUpdate={set.has("leave.request:update")}
      canDelete={set.has("leave.request:delete")}
      canApprove={set.has("leave.approval:approve")}
    />
  );
}
