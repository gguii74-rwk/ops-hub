import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { listRoundDates } from "@/modules/workflows/services/billing-config";
import { buildTransitionCtx, mapError } from "../../../../_shared";

export async function GET(_req: Request, { params }: { params: Promise<{ year: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const y = Number((await params).year);
  if (!Number.isInteger(y)) return NextResponse.json({ error: "invalid year" }, { status: 400 });
  try {
    const summary = await getPermissionSummary(session.user.id);
    const items = await listRoundDates(buildTransitionCtx(session.user, summary), y);
    return NextResponse.json(items, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return mapError(e); }
}
