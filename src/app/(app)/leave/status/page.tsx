import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";

export default async function LeaveStatusPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  if (!new Set(keys).has("leave.status:view"))
    return <p className="text-sm text-muted-foreground">연차 현황 열람 권한이 없습니다.</p>;
  return <p className="text-sm text-muted-foreground">연차 현황 화면은 준비 중입니다.</p>;
}
