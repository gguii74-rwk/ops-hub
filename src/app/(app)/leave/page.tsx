import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { DashboardClient } from "./_components/dashboard-client";

export default async function LeavePage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  if (!new Set(keys).has("leave.request:view"))
    return <p className="text-sm text-muted-foreground">연차 열람 권한이 없습니다.</p>;
  return <DashboardClient />;
}
