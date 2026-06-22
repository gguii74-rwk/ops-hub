import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { assignRoles } from "@/modules/admin/users/services";
import { rolesBodySchema } from "@/modules/admin/users/validations";
import { parseExpectedUpdatedAt } from "@/kernel/optimistic";
import { authorize, buildActorCtx, mapError } from "../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = rolesBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const { updatedAt, roleKeys } = parsed.data;
  try {
    const summary = await authorize(session.user.id, "admin.users", "update");
    await assignRoles(buildActorCtx(session.user, summary), id, roleKeys, parseExpectedUpdatedAt(updatedAt));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
