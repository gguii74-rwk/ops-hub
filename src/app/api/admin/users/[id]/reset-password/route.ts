import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resetPassword } from "@/modules/admin/users/services";
import { authorize, buildActorCtx, mapError } from "../../_shared";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    const summary = await authorize(session.user.id, "admin.users", "update");
    const result = await resetPassword(buildActorCtx(session.user, summary), id);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
