import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { cancelTask } from "@/modules/workflows/services/lifecycle";
import { buildTransitionCtx, mapError } from "../../_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;

  // 본문은 선택(note). 없거나 비-JSON이면 무시.
  let note: string | undefined;
  try {
    const body = await req.json();
    if (body && typeof body === "object" && typeof (body as { note?: unknown }).note === "string") {
      note = (body as { note: string }).note;
    }
  } catch {
    /* 본문 없음 — 허용 */
  }

  try {
    const summary = await getPermissionSummary(session.user.id);
    await cancelTask(id, buildTransitionCtx(session.user, summary.keys, note));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
