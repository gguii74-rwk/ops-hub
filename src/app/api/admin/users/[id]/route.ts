import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { getUserForEdit, updateUser } from "@/modules/admin/users/services";
import { updateUserSchema } from "@/modules/admin/users/validations";
import { buildActorCtx, mapError } from "../_shared";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    await requirePermission(session.user.id, "admin.users", "view");
    const summary = await getPermissionSummary(session.user.id);
    const detail = await getUserForEdit(buildActorCtx(session.user, summary), id);
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  // finding E — zod가 unknown 키(예: status)를 strip하므로 알려진 필드가 0개면 빈 patch다.
  // 빈 patch를 통과시키면 실제 상태는 안 바뀐 채 성공(200)을 반환한다(status 토글 누수). 400으로 거부한다.
  if (Object.keys(parsed.data).length === 0) return NextResponse.json({ error: "empty patch" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "admin.users", "update");
    const summary = await getPermissionSummary(session.user.id);
    await updateUser(buildActorCtx(session.user, summary), id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
