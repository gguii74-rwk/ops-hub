import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { adjustAllocation } from "@/modules/leave/services/allocations";
import { adjustAllocationSchema } from "@/modules/leave/validations";
import { mapError } from "@/app/api/leave/_shared";

export async function POST(req: Request, { params }: { params: Promise<{ userId: string; year: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { userId, year } = await params;
  const y = Number(year);
  if (!Number.isInteger(y)) return NextResponse.json({ error: "invalid year" }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = adjustAllocationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "leave.allocation", "configure");
    const { allocation } = await adjustAllocation({ userId, year: y, ...parsed.data }, session.user.id);
    return NextResponse.json({ id: allocation.id });
  } catch (error) {
    return mapError(error);
  }
}
