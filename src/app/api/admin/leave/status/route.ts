import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { getAllEmployeesStatus } from "@/modules/leave/services/status";
import { mapError, parseYear } from "@/app/api/leave/_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear(new URL(req.url).searchParams.get("year"));
  try {
    await requirePermission(session.user.id, "leave.status", "view");
    const items = await getAllEmployeesStatus(year);
    return NextResponse.json({ year, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
