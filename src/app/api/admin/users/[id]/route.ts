import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserForEdit, updateUser } from "@/modules/admin/users/services";
import { updateUserBodySchema } from "@/modules/admin/users/validations";
import { parseExpectedUpdatedAt } from "@/kernel/optimistic";
import { authorize, buildActorCtx, mapError } from "../_shared";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    const summary = await authorize(session.user.id, "admin.users", "view");
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
  const parsed = updateUserBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const { updatedAt, ...patch } = parsed.data;
  // finding E — zod가 unknown 키(예: status)를 strip하므로 알려진 필드가 0개면 빈 patch다.
  // 빈 patch를 통과시키면 실제 상태는 안 바뀐 채 성공(200)을 반환한다(status 토글 누수). 400으로 거부한다.
  // updatedAt은 낙관락용 메타라 patch 필드 카운트에서 제외(updatedAt만 있고 실제 patch 0개면 거부).
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "empty patch" }, { status: 400 });
  try {
    const summary = await authorize(session.user.id, "admin.users", "update");
    await updateUser(buildActorCtx(session.user, summary), id, patch, parseExpectedUpdatedAt(updatedAt));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
