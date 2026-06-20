import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission, getPermissionSummary } from "@/kernel/access";
import { getLeaveCalendar } from "@/modules/leave/services/calendar";
import { parseLeaveDate } from "@/modules/leave/rules";
import { mapError } from "@/app/api/leave/_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(req.url);
  try {
    await requirePermission(session.user.id, "leave.request", "view");
    const now = new Date();
    const startStr = url.searchParams.get("start");
    const endStr = url.searchParams.get("end");
    const start = startStr
      ? parseLeaveDate(startStr)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = endStr
      ? parseLeaveDate(endStr)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    const keys = new Set((await getPermissionSummary(session.user.id)).keys);
    const canCross = keys.has("leave.status:view") || keys.has("leave.admin:view");
    // 부서 필터는 cross 권한자만 — 일반 사용자가 보내도 무시(service가 자기 부서로 한정).
    const events = await getLeaveCalendar({
      viewerId: session.user.id,
      canCrossUserAllStatuses: canCross,
      start,
      end,
      filterDepartment: canCross ? url.searchParams.get("department") : null,
    });
    return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
