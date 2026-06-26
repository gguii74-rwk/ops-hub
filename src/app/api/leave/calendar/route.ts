import { NextResponse } from "next/server";
import type { JobFunction } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requirePermission, getPermissionSummary } from "@/kernel/access";
import { getLeaveCalendar } from "@/modules/leave/services/calendar";
import { getHolidayEventsInRange, getUnsyncedYears } from "@/kernel/holidays";
import { parseLeaveDate } from "@/modules/leave/rules";
import { LeaveValidationError } from "@/modules/leave/errors";
import { isAnchorWithinWindow } from "@/modules/calendar/time";
import { MAX_ANCHOR_MONTHS } from "@/modules/calendar/constants";
import { mapError } from "@/app/api/leave/_shared";

const MS_PER_DAY = 86_400_000;
const MAX_WINDOW_DAYS = 46; // 월 그리드 한 화면(≤6주) — feed normalizeToGridWindow와 동일 폭(D10)
const JOB_FILTERS: JobFunction[] = ["DEVELOPER", "CIVIL_RESPONSE", "CONTENT_MANAGER"]; // PM 제외(D2)

// 쿼리 job → JobFunction|null(무필터). 화이트리스트 외 값은 400(LeaveValidationError).
function parseJob(raw: string | null): JobFunction | null {
  if (!raw || raw === "ALL") return null;
  if ((JOB_FILTERS as string[]).includes(raw)) return raw as JobFunction;
  throw new LeaveValidationError(`직무 값이 올바르지 않습니다: ${raw}`);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(req.url);
  try {
    await requirePermission(session.user.id, "leave.request", "view");
    const now = new Date();
    const startStr = url.searchParams.get("start");
    const endStr = url.searchParams.get("end");
    const start = startStr
      ? parseLeaveDate(startStr)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = endStr
      ? parseLeaveDate(endStr)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

    // 윈도우 입력 검증(D10): ① start≤end ② 일수 상한(≤46일) ③ 양 끝 운영 창(now±MAX_ANCHOR_MONTHS). 위반 시 400.
    if (start.getTime() > end.getTime())
      throw new LeaveValidationError("시작일은 종료일보다 이전이어야 합니다.");
    if (end.getTime() - start.getTime() > MAX_WINDOW_DAYS * MS_PER_DAY)
      throw new LeaveValidationError("조회 범위가 너무 넓습니다.");
    if (!isAnchorWithinWindow(start, now, MAX_ANCHOR_MONTHS) || !isAnchorWithinWindow(end, now, MAX_ANCHOR_MONTHS))
      throw new LeaveValidationError("조회 범위가 허용 창을 벗어났습니다.");

    const job = parseJob(url.searchParams.get("job"));

    const keys = new Set((await getPermissionSummary(session.user.id)).keys);
    // admin:view만 전 상태·마스킹 해제. status:view는 팀 경계만 넘되 APPROVED-only·마스킹(사유 보호).
    const canViewAllStatuses = keys.has("leave.admin:view");
    const canCrossTeam = canViewAllStatuses || keys.has("leave.status:view");
    const events = await getLeaveCalendar({
      viewerId: session.user.id,
      canViewAllStatuses,
      canCrossTeam,
      start,
      end,
      filterTeamId: canCrossTeam ? url.searchParams.get("teamId") : null,
      job,
    });

    // 조회 윈도우가 걸친 연도(D10으로 ≤2). 공휴일은 read-only(D8) — 동기화 호출 없음.
    const years: number[] = [];
    for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) years.push(y);
    let holidays: { date: string; name: string }[] = [];
    let unsyncedYears: number[];
    try {
      holidays = await getHolidayEventsInRange(start, end);
      unsyncedYears = await getUnsyncedYears(years);
    } catch (e) {
      // D9 불변식(F3): 미적재·실패를 깨끗한 빈 상태로 둔갑시키지 않는다 — 윈도우 전체 연도를 보수적 degraded 신호로.
      console.error("[leave/calendar] 공휴일 조회 실패(degraded):", e);
      holidays = [];
      unsyncedYears = years;
    }

    return NextResponse.json({ events, holidays, unsyncedYears }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
