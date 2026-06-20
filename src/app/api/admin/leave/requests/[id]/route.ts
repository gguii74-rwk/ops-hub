import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { updateByAdmin, deleteByAdmin } from "@/modules/leave/services/requests";
import { updateLeaveSchema, deleteLeaveSchema } from "@/modules/leave/validations";
import { mapError } from "@/app/api/leave/_shared";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = updateLeaveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "leave.request", "update");
    const updated = await updateByAdmin(id, parsed.data, session.user.id);
    return NextResponse.json({ id: updated.id });
  } catch (error) {
    return mapError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  // 사유 필수는 서버에서 강제(접근제어 규칙 #1) — 누락·공백이면 400, 서비스 미호출. 파싱·검증은 mapError try 밖에서 해 400을 그대로 반환.
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = deleteLeaveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "삭제 사유는 필수입니다." }, { status: 400 });
  try {
    await requirePermission(session.user.id, "leave.request", "delete");
    await deleteByAdmin(id, session.user.id, parsed.data.reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
