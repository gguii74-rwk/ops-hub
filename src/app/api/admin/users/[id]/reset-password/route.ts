import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { resetPassword } from "@/modules/admin/users/services";
import { buildActorCtx, mapError } from "../../_shared";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    await requirePermission(session.user.id, "admin.users", "update");
    const summary = await getPermissionSummary(session.user.id);
    const result = await resetPassword(buildActorCtx(session.user, summary), id);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
