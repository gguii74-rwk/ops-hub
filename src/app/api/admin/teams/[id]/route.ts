import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/kernel/access";
import { updateTeamAsAdmin } from "@/modules/admin/teams/services";
import { updateTeamBodySchema } from "@/modules/admin/teams/validations";
import { TeamConflictError, TeamInvariantError } from "@/modules/admin/teams/errors";
import { parseExpectedUpdatedAt } from "@/kernel/optimistic";

function mapError(e: unknown) {
  if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof TeamInvariantError) return NextResponse.json({ error: e.message }, { status: 422 });
  if (e instanceof TeamConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
  return NextResponse.json({ error: "서버 오류" }, { status: 500 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = updateTeamBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const { updatedAt, ...patch } = parsed.data;
  try {
    await updateTeamAsAdmin(session.user.id, id, patch, parseExpectedUpdatedAt(updatedAt));
    return NextResponse.json({ ok: true });
  } catch (e) { return mapError(e); }
}
