import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/kernel/access";
import { setRoleCellsBulk } from "@/modules/admin/roles/services";
import { bulkSetSchema } from "@/modules/admin/roles/validations";

export async function PUT(req: Request, { params }: { params: Promise<{ roleId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { roleId } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = bulkSetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    const result = await setRoleCellsBulk(session.user.id, roleId, parsed.data.resourcePrefix, parsed.data.effect);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
