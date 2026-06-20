import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { LeaveSummary } from "./leave-summary";
import { LeaveRequestForm } from "./leave-request-form";
import { MyRequests } from "./my-requests";

export default async function LeavePage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const canView = new Set(keys).has("leave.request:view");
  if (!canView) return <p className="text-sm text-muted-foreground">연차 열람 권한이 없습니다.</p>;
  return (
    <div className="space-y-6">
      <LeaveSummary />
      <LeaveRequestForm />
      <div className="space-y-2">
        <h2 className="font-medium">내 신청 내역</h2>
        <MyRequests />
      </div>
    </div>
  );
}
