import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { LeaveSummary } from "../leave-summary";
import { LeaveRequestForm } from "../leave-request-form";

export default async function LeaveRequestPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  if (!new Set(keys).has("leave.request:create")) return <p className="text-sm text-muted-foreground">연차 신청 권한이 없습니다.</p>;
  const { date } = await searchParams;
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  return (
    <div className="space-y-6">
      <LeaveSummary />
      <LeaveRequestForm defaultDate={validDate} />
    </div>
  );
}
