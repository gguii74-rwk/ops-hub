import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reparentNavigationItem } from "@/modules/admin/navigation/services";
import { reparentNavBodySchema } from "@/modules/admin/navigation/validations";
import { parseExpectedUpdatedAt } from "@/kernel/optimistic";
import { mapError } from "../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = reparentNavBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await reparentNavigationItem(session.user.id, id, parsed.data.newParentId, parseExpectedUpdatedAt(parsed.data.updatedAt));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
