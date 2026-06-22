import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { updateByAdmin, deleteByAdmin } from "@/modules/leave/services/requests";
import { updateLeaveBodySchema, deleteLeaveSchema } from "@/modules/leave/validations";
import { parseExpectedUpdatedAt } from "@/kernel/optimistic";
import { mapError } from "@/app/api/leave/_shared";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = updateLeaveBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const { updatedAt, ...input } = parsed.data;
  try {
    // cross-user 관리자 mutation 경계: admin 전체이력 권한 + 수정 권한 둘 다 요구(접근제어 규칙 #1 —
    // UI는 admin-history(admin:view 게이트) 안에서만 수정 컨트롤을 노출하므로 API도 동일 키 검사).
    await requirePermission(session.user.id, "leave.admin", "view");
    await requirePermission(session.user.id, "leave.request", "update");
    const updated = await updateByAdmin(id, input, session.user.id, parseExpectedUpdatedAt(updatedAt));
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
    // cross-user 관리자 mutation 경계: admin 전체이력 권한 + 삭제 권한 둘 다 요구(접근제어 규칙 #1).
    await requirePermission(session.user.id, "leave.admin", "view");
    await requirePermission(session.user.id, "leave.request", "delete");
    await deleteByAdmin(id, session.user.id, parsed.data.reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
