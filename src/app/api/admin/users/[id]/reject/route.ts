import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { rejectUser } from "@/modules/admin/users/services";
import { rejectSchema } from "@/modules/admin/users/validations";
import { buildActorCtx, mapError } from "../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "admin.users", "approve");
    const summary = await getPermissionSummary(session.user.id);
    await rejectUser(buildActorCtx(session.user, summary), id, parsed.data.reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
