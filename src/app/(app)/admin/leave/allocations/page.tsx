import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { AllocationsClient } from "./allocations-client";

export default async function AllocationsPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const set = new Set(keys);
  const canView = set.has("leave.allocation:view");
  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">연차 할당</h1>
      {!canView ? (
        <p className="text-sm text-muted-foreground">할당 열람 권한이 없습니다.</p>
      ) : (
        <AllocationsClient canConfigure={set.has("leave.allocation:configure")} />
      )}
    </section>
  );
}
