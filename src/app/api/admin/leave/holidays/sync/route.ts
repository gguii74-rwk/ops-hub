import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { syncHolidaysForYear, getUnsyncedYears } from "@/kernel/holidays";
import { mapError, parseYear } from "@/app/api/leave/_shared";

// 현재+익년 중 미적재 연도 조회(admin 미적재 알림용). view 권한.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const now = new Date().getFullYear();
  try {
    await requirePermission(session.user.id, "leave.allocation", "view");
    const unsynced = await getUnsyncedYears([now, now + 1]);
    return NextResponse.json({ unsynced }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear(new URL(req.url).searchParams.get("year"));
  try {
    await requirePermission(session.user.id, "leave.allocation", "configure");
    const count = await syncHolidaysForYear(year);
    return NextResponse.json({ year, count });
  } catch (error) {
    return mapError(error);
  }
}
