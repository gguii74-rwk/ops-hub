import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { runGenerate } from "@/modules/workflows/services/generate";
import { buildTransitionCtx, mapError } from "../../_shared";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    const summary = await getPermissionSummary(session.user.id);
    await runGenerate(id, buildTransitionCtx(session.user, summary)); // 권한은 runGenerate 내부에서 kind별 게이트
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return mapError(e); }
}
