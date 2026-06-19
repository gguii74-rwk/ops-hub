import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { resolveDelivery } from "@/modules/workflows/services/mail";
import { resolveSchema } from "@/modules/workflows/validations";
import { buildMailCtx, mapError } from "../../../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; deliveryId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, deliveryId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });

  try {
    const summary = await getPermissionSummary(session.user.id);
    const out = await resolveDelivery({ deliveryId, taskId: id, to: parsed.data.to }, buildMailCtx(session.user, summary.keys));
    return NextResponse.json({ id: out.id, status: out.status });
  } catch (error) {
    return mapError(error);
  }
}
