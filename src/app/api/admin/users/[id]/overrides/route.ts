import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { upsertOverride, removeOverride } from "@/modules/admin/users/services";
import { overrideSchema } from "@/modules/admin/users/validations";
import { authorize, buildActorCtx, mapError } from "../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    const summary = await authorize(session.user.id, "admin.users", "update");
    const created = await upsertOverride(buildActorCtx(session.user, summary), id, parsed.data);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    return mapError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const overrideId = new URL(req.url).searchParams.get("overrideId");
  if (!overrideId) return NextResponse.json({ error: "overrideId required" }, { status: 400 });
  try {
    const summary = await authorize(session.user.id, "admin.users", "update");
    await removeOverride(buildActorCtx(session.user, summary), id, overrideId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
