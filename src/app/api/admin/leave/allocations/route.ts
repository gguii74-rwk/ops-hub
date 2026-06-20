import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { listAllocations } from "@/modules/leave/services/allocations";
import { mapError, parseYear } from "@/app/api/leave/_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear(new URL(req.url).searchParams.get("year"));
  try {
    await requirePermission(session.user.id, "leave.allocation", "view");
    const items = await listAllocations(year);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
