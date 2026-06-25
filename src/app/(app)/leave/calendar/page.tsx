import { auth } from "@/lib/auth";
import { getPermissionSummary, getEffectiveScope } from "@/kernel/access";
import { LeaveCalendar } from "../_components/leave-calendar";

export default async function LeaveCalendarPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const set = new Set(keys);
  if (!set.has("leave.request:view"))
    return <p className="text-sm text-muted-foreground">연차 캘린더 권한이 없습니다.</p>;
  const approvalScope = session?.user ? await getEffectiveScope(session.user.id, "leave.approval", "approve") : null;
  return <LeaveCalendar canCreate={set.has("leave.request:create")} canManage={approvalScope === "all"} />;
}
