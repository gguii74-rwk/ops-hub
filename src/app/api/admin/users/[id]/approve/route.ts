import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { approveUser } from "@/modules/admin/users/services";
import { approveBodySchema } from "@/modules/admin/users/validations";
import { parseExpectedUpdatedAt } from "@/kernel/optimistic";
import { authorize, buildActorCtx, mapError } from "../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = approveBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const { updatedAt, ...input } = parsed.data;
  try {
    const summary = await authorize(session.user.id, "admin.users", "approve");
    await approveUser(buildActorCtx(session.user, summary), id, input, parseExpectedUpdatedAt(updatedAt));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
