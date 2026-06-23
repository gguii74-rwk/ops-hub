import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission, ForbiddenError } from "@/kernel/access";
import { getRoleMatrix } from "@/modules/admin/roles/services";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    await requirePermission(session.user.id, "admin.roles", "view");
    const matrix = await getRoleMatrix();
    return NextResponse.json(matrix, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
