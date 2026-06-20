import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { LeaveSummary } from "./leave-summary";
import { LeaveRequestForm } from "./leave-request-form";
import { MyRequests } from "./my-requests";

export default async function LeavePage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const canView = new Set(keys).has("leave.request:view");

  return (
    <section className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">연차</h1>
      {!canView ? (
        <p className="text-sm text-muted-foreground">연차 열람 권한이 없습니다.</p>
      ) : (
        <>
          <LeaveSummary />
          <LeaveRequestForm />
          <div className="space-y-2">
            <h2 className="font-medium">내 신청 내역</h2>
            <MyRequests />
          </div>
        </>
      )}
    </section>
  );
}
