import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { getRequest } from "@/modules/leave/services/requests";
import { buildLeaveCtx, mapError } from "../../_shared";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    await requirePermission(session.user.id, "leave.request", "view");
    const summary = await getPermissionSummary(session.user.id);
    const r = await getRequest(id, buildLeaveCtx(session.user, summary.keys));
    if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ request: r }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
