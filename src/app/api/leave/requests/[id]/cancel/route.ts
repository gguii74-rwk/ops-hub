import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { cancel } from "@/modules/leave/services/requests";
import { buildLeaveCtx, mapError } from "../../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let reason: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body === "object" && typeof (body as { reason?: unknown }).reason === "string") {
      reason = (body as { reason: string }).reason;
    }
  } catch { /* 본문 없음 허용 */ }
  try {
    await requirePermission(session.user.id, "leave.request", "cancel");
    const summary = await getPermissionSummary(session.user.id);
    await cancel(id, buildLeaveCtx(session.user, summary), reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
