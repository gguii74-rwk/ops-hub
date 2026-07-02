import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { getCalendarTasks } from "@/modules/workflows/services/tasks";
import { isAnchorWithinWindow } from "@/modules/calendar/time";
import { MAX_ANCHOR_MONTHS } from "@/modules/calendar/constants";
import { mapError } from "../_shared";

const MS_PER_DAY = 86_400_000;
const MAX_WINDOW_DAYS = 46; // 월 그리드 6주(42일) + 여유. 무제한 조회 차단(D5)
// 월 그리드는 인접월로 ~1주 spillover → 허용 anchor(±MAX_ANCHOR_MONTHS) 월의 grid 끝이 ±(MAX_ANCHOR_MONTHS+1)월에 닿음(leave와 동일).
const MAX_EDGE_MONTHS = MAX_ANCHOR_MONTHS + 1;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(req.url);
  const startStr = url.searchParams.get("start");
  const endStr = url.searchParams.get("end");
  // D5: range 필수 — 누락·빈값은 400(전체 이력 반환 금지, 클라 규율에 의존하지 않음).
  if (!startStr || !endStr) return NextResponse.json({ error: "range required" }, { status: 400 });
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return NextResponse.json({ error: "invalid range" }, { status: 400 });
  if (start.getTime() >= end.getTime())
    return NextResponse.json({ error: "start must be before end" }, { status: 400 });
  if (end.getTime() - start.getTime() > MAX_WINDOW_DAYS * MS_PER_DAY)
    return NextResponse.json({ error: "range too wide" }, { status: 400 });
  const now = new Date();
  if (!isAnchorWithinWindow(start, now, MAX_EDGE_MONTHS) || !isAnchorWithinWindow(end, now, MAX_EDGE_MONTHS))
    return NextResponse.json({ error: "range out of window" }, { status: 400 });

  try {
    const summary = await getPermissionSummary(session.user.id);
    // end는 exclusive(클라가 winEnd 그대로 전송) — repo가 scheduledAt<end라 마지막 그리드 셀 포함(R4·F2).
    const items = await getCalendarTasks({ permissionKeys: new Set(summary.keys) }, { start, end });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
