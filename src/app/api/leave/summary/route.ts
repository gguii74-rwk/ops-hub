import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { getAllocationSummary } from "@/modules/leave/services/allocations";
import { mapError, parseYear } from "../_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear(new URL(req.url).searchParams.get("year"));
  try {
    await requirePermission(session.user.id, "leave.request", "view");
    const summary = await getAllocationSummary(session.user.id, year);
    return NextResponse.json({ summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
