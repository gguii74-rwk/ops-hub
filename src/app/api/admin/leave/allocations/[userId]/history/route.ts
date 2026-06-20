import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { getAllocationHistory } from "@/modules/leave/services/allocations";
import { mapError, parseYear } from "@/app/api/leave/_shared";

export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { userId } = await params;
  const yearParam = new URL(req.url).searchParams.get("year");
  const year = yearParam ? parseYear(yearParam) : undefined;
  try {
    await requirePermission(session.user.id, "leave.allocation", "view");
    const items = await getAllocationHistory(userId, year);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
