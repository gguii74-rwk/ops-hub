import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError, getPermissionSummary, requirePermission } from "@/kernel/access";
import { isViewKey, VIEW_PERMISSION } from "@/modules/calendar/views";
import { MAX_ANCHOR_MONTHS } from "@/modules/calendar/constants";
import { isAnchorWithinWindow, normalizeToGridWindow } from "@/modules/calendar/time";
import { buildFeed } from "@/modules/calendar/feed";
import { createCalendarProviders } from "@/modules/calendar/providers";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "";
  const start = url.searchParams.get("start") ?? "";
  if (!isViewKey(view)) return NextResponse.json({ error: "invalid view" }, { status: 400 });
  const anchor = new Date(start);
  if (Number.isNaN(anchor.getTime())) return NextResponse.json({ error: "invalid start" }, { status: 400 });
  // 앵커를 운영 창(now 기준 ±MAX_ANCHOR_MONTHS)으로 제한 — 무제한 달 열거로 인한 외부 호출·캐시 행 증가 차단(적대적 리뷰).
  if (!isAnchorWithinWindow(anchor, new Date(), MAX_ANCHOR_MONTHS)) return NextResponse.json({ error: "start out of allowed window" }, { status: 400 });

  try {
    await requirePermission(session.user.id, VIEW_PERMISSION[view], "view");
    const range = normalizeToGridWindow(anchor);
    const summary = await getPermissionSummary(session.user.id);
    const ctx = { userId: session.user.id, isOwner: false, permissionKeys: new Set(summary.keys) };
    const providers = createCalendarProviders({ forceRefresh: false });
    const feed = await buildFeed(view, range, ctx, providers);
    return NextResponse.json(feed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
