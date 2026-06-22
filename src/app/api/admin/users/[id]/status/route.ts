import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { setUserStatus } from "@/modules/admin/users/services";
import { expectedUpdatedAt, parseExpectedUpdatedAt } from "@/kernel/optimistic";
import { authorize, buildActorCtx, mapError } from "../../_shared";

const statusSchema = z.object({ status: z.enum(["ACTIVE", "DISABLED"]), updatedAt: expectedUpdatedAt });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    const summary = await authorize(session.user.id, "admin.users", "update");
    await setUserStatus(buildActorCtx(session.user, summary), id, parsed.data.status, parseExpectedUpdatedAt(parsed.data.updatedAt));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
