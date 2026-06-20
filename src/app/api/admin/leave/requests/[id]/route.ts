import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { updateByAdmin, deleteByAdmin } from "@/modules/leave/services/requests";
import { updateLeaveSchema } from "@/modules/leave/validations";
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
    const updated = await updateByAdmin(id, parsed.data);
    return NextResponse.json({ id: updated.id });
  } catch (error) {
    return mapError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    await requirePermission(session.user.id, "leave.request", "delete");
    await deleteByAdmin(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
