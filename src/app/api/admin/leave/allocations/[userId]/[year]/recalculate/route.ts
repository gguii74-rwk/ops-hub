import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { recalculate } from "@/modules/leave/services/allocations";
import { mapError } from "@/app/api/leave/_shared";

export async function POST(_req: Request, { params }: { params: Promise<{ userId: string; year: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { userId, year } = await params;
  const y = Number(year);
  if (!Number.isInteger(y)) return NextResponse.json({ error: "invalid year" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "leave.allocation", "configure");
    const usedDays = await recalculate(userId, y);
    return NextResponse.json({ usedDays });
  } catch (error) {
    return mapError(error);
  }
}
