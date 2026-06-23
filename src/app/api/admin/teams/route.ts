import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission, ForbiddenError } from "@/kernel/access";
import { listTeamsForAdmin, createTeamAsAdmin } from "@/modules/admin/teams/services";
import { createTeamSchema } from "@/modules/admin/teams/validations";
import { TeamConflictError, TeamInvariantError } from "@/modules/admin/teams/errors";

function mapError(e: unknown) {
  if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof TeamInvariantError) return NextResponse.json({ error: e.message }, { status: 422 });
  if (e instanceof TeamConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
  return NextResponse.json({ error: "서버 오류" }, { status: 500 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    await requirePermission(session.user.id, "admin.teams", "view");
    const teams = await listTeamsForAdmin();
    return NextResponse.json({ teams }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return mapError(e); }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = createTeamSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    const created = await createTeamAsAdmin(session.user.id, parsed.data);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (e) { return mapError(e); }
}
