import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { retryDelivery } from "@/modules/workflows/services/mail";
import { buildMailCtx, mapError } from "../../../../_shared";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; deliveryId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, deliveryId } = await params;

  try {
    const summary = await getPermissionSummary(session.user.id);
    const out = await retryDelivery({ deliveryId, taskId: id }, buildMailCtx(session.user, summary));
    return NextResponse.json({ id: out.id, status: out.status });
  } catch (error) {
    return mapError(error);
  }
}
