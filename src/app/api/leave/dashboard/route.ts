import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission, getPermissionSummary } from "@/kernel/access";
import { getEmployeeDashboard, getAdminDashboard } from "@/modules/leave/services/dashboard";
import { mapError } from "@/app/api/leave/_shared";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    await requirePermission(session.user.id, "leave.request", "view");
    const employee = await getEmployeeDashboard(session.user.id);
    const keys = new Set((await getPermissionSummary(session.user.id)).keys);
    // cross-user 통계: leave.status:view 또는 leave.admin:view 보유 시에만 — leave.approval:view 단독은 비노출(SC-2 경계)
    const showAdmin = keys.has("leave.status:view") || keys.has("leave.admin:view");
    const admin = showAdmin ? await getAdminDashboard() : null;
    return NextResponse.json({ employee, admin }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
