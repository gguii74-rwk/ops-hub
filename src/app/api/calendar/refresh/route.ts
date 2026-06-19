import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError, getPermissionSummary, requirePermission } from "@/kernel/access";
import { isViewKey, VIEW_PERMISSION } from "@/modules/calendar/views";
import { MAX_ANCHOR_MONTHS } from "@/modules/calendar/constants";
import { isAnchorWithinWindow, normalizeToGridWindow } from "@/modules/calendar/time";
import { buildFeed } from "@/modules/calendar/feed";
import { createCalendarProviders } from "@/modules/calendar/providers";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const view = body?.view ?? "";
  const start = body?.start ?? "";
  if (!isViewKey(view)) return NextResponse.json({ error: "invalid view" }, { status: 400 });
  const anchor = new Date(start);
  if (Number.isNaN(anchor.getTime())) return NextResponse.json({ error: "invalid start" }, { status: 400 });
  // 앵커를 운영 창(now 기준 ±MAX_ANCHOR_MONTHS)으로 제한 — refresh는 forceRefresh라 무제한 달 열거 시 Google 강제 호출이 누적된다(적대적 리뷰).
  if (!isAnchorWithinWindow(anchor, new Date(), MAX_ANCHOR_MONTHS)) return NextResponse.json({ error: "start out of allowed window" }, { status: 400 });

  try {
    await requirePermission(session.user.id, VIEW_PERMISSION[view], "view");
    const range = normalizeToGridWindow(anchor);
    const summary = await getPermissionSummary(session.user.id);
    const ctx = { userId: session.user.id, isOwner: session.user.systemRole === "OWNER", permissionKeys: new Set(summary.keys) };
    // forceRefresh: (view,range) 범위만 강제 재검증. 전역 캐시 무효화 아님. min-interval은 cache가 가드.
    const providers = createCalendarProviders({ forceRefresh: true });
    const feed = await buildFeed(view, range, ctx, providers);
    return NextResponse.json(feed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
