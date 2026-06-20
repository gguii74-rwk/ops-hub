# Task 11 — 연차 전용 캘린더(부서 스코프·APPROVED-only·마스킹)

**목적:** `LeaveRequest`만 그리는 월간 캘린더. 일반 사용자는 본인(전 상태) + 같은 부서 타인(APPROVED만, 사유·세부 마스킹)을 보고, 부서가 없으면 self-only fail-closed. status/admin 권한자는 전체·전 상태 + 부서 필터. 날짜 클릭 → 신청 prefill.

## Files
- Create: `src/modules/leave/services/calendar.ts`
- Create: `src/app/api/leave/calendar/route.ts`
- Modify: `src/app/(app)/leave/calendar/page.tsx` (Task 04 stub → 실제)
- Create: `src/app/(app)/leave/_components/leave-calendar.tsx`
- Create: `tests/modules/leave/calendar-service.test.ts`

## Prep
- 엔트리포인트 §SC-2(캘린더 가시성), spec §6.7(APPROVED-only·부서 null self-only·마스킹·부서 필터 서버 강제).
- 세션엔 `department`가 **없다**(SessionUser) → service가 `prisma.user.findUnique`로 조회.
- 통합 캘린더(`src/modules/calendar`, `/calendar`)는 **건드리지 않는다** — 이건 독립 도메인.

## Deps
Task 02(labels), Task 06(deletedAt 필터 정합). Task 07 모달(관리자 입력 버튼, 선택적).

## Steps

### 1. (TDD) calendar service 테스트 → FAIL

`tests/modules/leave/calendar-service.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn(), findMany: vi.fn() }, leaveRequest: { findMany: vi.fn() } } }));
import { getLeaveCalendar } from "@/modules/leave/services/calendar";
import { prisma } from "@/lib/prisma";
beforeEach(() => vi.clearAllMocks());

const range = { start: new Date("2026-07-01T00:00:00Z"), end: new Date("2026-07-31T00:00:00Z") };

describe("getLeaveCalendar — 일반 사용자", () => {
  it("부서 있으면 본인(전상태) OR 같은부서 타인(APPROVED)로 조회", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ department: "개발" } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u2" }] as never); // dept others
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // names
    await getLeaveCalendar({ viewerId: "u1", canCrossUserAllStatuses: false, ...range });
    const where = vi.mocked(prisma.leaveRequest.findMany).mock.calls[0][0].where;
    expect(where.OR).toEqual(expect.arrayContaining([
      { userId: "u1" }, { userId: { in: ["u2"] }, status: "APPROVED" },
    ]));
  });
  it("부서 null이면 self-only(OR에 본인만)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ department: null } as never);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    await getLeaveCalendar({ viewerId: "u1", canCrossUserAllStatuses: false, ...range });
    const where = vi.mocked(prisma.leaveRequest.findMany).mock.calls[0][0].where;
    expect(where.OR).toEqual([{ userId: "u1" }]);
  });
  it("타인 APPROVED 항목의 사유·세부를 마스킹", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ department: "개발" } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u2" }] as never);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      { id: "r2", userId: "u2", leaveType: "QUARTER", leaveSubType: null, quarterStartTime: "09:00", startDate: range.start, endDate: range.start, status: "APPROVED", reason: "비밀" },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u2", name: "이" }] as never);
    const ev = await getLeaveCalendar({ viewerId: "u1", canCrossUserAllStatuses: false, ...range });
    expect(ev[0]).toMatchObject({ name: "이", leaveType: "QUARTER", reason: null, quarterStartTime: null, isSelf: false });
  });
});

describe("getLeaveCalendar — status/admin 권한", () => {
  it("전체·전상태로 조회하고 마스킹 안 함", async () => {
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      { id: "r3", userId: "u3", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null, startDate: range.start, endDate: range.start, status: "PENDING", reason: "사유" },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u3", name: "박" }] as never);
    const ev = await getLeaveCalendar({ viewerId: "u1", canCrossUserAllStatuses: true, ...range });
    expect(ev[0]).toMatchObject({ reason: "사유", isSelf: false });
    const where = vi.mocked(prisma.leaveRequest.findMany).mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
  });
});
```
실행 → **FAIL**.

### 2. calendar service 구현 → PASS

`src/modules/leave/services/calendar.ts`:
```ts
import "server-only";
import { prisma } from "@/lib/prisma";

export interface LeaveCalendarEvent {
  id: string; userId: string; name: string; leaveType: string;
  leaveSubType: string | null; quarterStartTime: string | null;
  startDate: Date; endDate: Date; status: string; reason: string | null; isSelf: boolean;
}

export async function getLeaveCalendar(params: {
  viewerId: string; canCrossUserAllStatuses: boolean; start: Date; end: Date; filterDepartment?: string | null;
}): Promise<LeaveCalendarEvent[]> {
  const { viewerId, canCrossUserAllStatuses, start, end } = params;
  const rangeAnd = [{ startDate: { lte: end } }, { endDate: { gte: start } }];

  let where: Record<string, unknown>;
  if (canCrossUserAllStatuses) {
    // status/admin: 전체 사용자·모든 상태. 부서 필터는 서버에서만(선택).
    let deptIds: string[] | null = null;
    if (params.filterDepartment) {
      const us = await prisma.user.findMany({ where: { department: params.filterDepartment, status: "ACTIVE" }, select: { id: true } });
      deptIds = us.map((u) => u.id);
    }
    where = { deletedAt: null, AND: rangeAnd, ...(deptIds ? { userId: { in: deptIds } } : {}) };
  } else {
    // 일반: 본인(전 상태) + 같은 부서 타인(APPROVED). 부서 null/빈 → self-only fail-closed.
    const me = await prisma.user.findUnique({ where: { id: viewerId }, select: { department: true } });
    const dept = me?.department?.trim();
    let deptOthers: string[] = [];
    if (dept) {
      const us = await prisma.user.findMany({ where: { department: dept, status: "ACTIVE", id: { not: viewerId } }, select: { id: true } });
      deptOthers = us.map((u) => u.id);
    }
    where = {
      deletedAt: null,
      AND: rangeAnd,
      OR: [{ userId: viewerId }, ...(deptOthers.length ? [{ userId: { in: deptOthers }, status: "APPROVED" as const }] : [])],
    };
  }

  const rows = await prisma.leaveRequest.findMany({
    where,
    select: { id: true, userId: true, leaveType: true, leaveSubType: true, quarterStartTime: true, startDate: true, endDate: true, status: true, reason: true },
    orderBy: { startDate: "asc" },
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((e) => {
    const isSelf = e.userId === viewerId;
    const masked = !isSelf && !canCrossUserAllStatuses; // 권한 없는 타인: 사유·세부 가림(이름·유형만)
    return {
      id: e.id, userId: e.userId, name: nameById.get(e.userId) ?? "직원", leaveType: e.leaveType,
      leaveSubType: masked ? null : e.leaveSubType, quarterStartTime: masked ? null : e.quarterStartTime,
      startDate: e.startDate, endDate: e.endDate, status: e.status, reason: masked ? null : e.reason, isSelf,
    };
  });
}
```
실행: 1번 → **PASS**.

### 3. API 라우트
`src/app/api/leave/calendar/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission, getPermissionSummary } from "@/kernel/access";
import { getLeaveCalendar } from "@/modules/leave/services/calendar";
import { parseLeaveDate } from "@/modules/leave/rules";
import { mapError } from "@/app/api/leave/_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(req.url);
  try {
    await requirePermission(session.user.id, "leave.request", "view");
    const now = new Date();
    const startStr = url.searchParams.get("start");
    const endStr = url.searchParams.get("end");
    const start = startStr ? parseLeaveDate(startStr) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = endStr ? parseLeaveDate(endStr) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    const keys = new Set((await getPermissionSummary(session.user.id)).keys);
    const canCross = keys.has("leave.status:view") || keys.has("leave.admin:view");
    // 부서 필터는 cross 권한자만 — 일반 사용자가 보내도 무시(service가 자기 부서로 한정).
    const events = await getLeaveCalendar({
      viewerId: session.user.id, canCrossUserAllStatuses: canCross, start, end,
      filterDepartment: canCross ? url.searchParams.get("department") : null,
    });
    return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
```

### 4. page + 월간 그리드
`src/app/(app)/leave/calendar/page.tsx` 교체:
```tsx
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { LeaveCalendar } from "../_components/leave-calendar";

export default async function LeaveCalendarPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const set = new Set(keys);
  if (!set.has("leave.request:view")) return <p className="text-sm text-muted-foreground">연차 캘린더 권한이 없습니다.</p>;
  return <LeaveCalendar canManage={set.has("leave.approval:approve")} />;
}
```
`src/app/(app)/leave/_components/leave-calendar.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getFullLeaveText } from "@/modules/leave/labels";
import { CreateLeaveModal } from "./create-leave-modal";

interface Ev { id: string; userId: string; name: string; leaveType: string; leaveSubType: string | null; quarterStartTime: string | null; startDate: string; endDate: string; status: string; isSelf: boolean; }

const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function colorFor(e: Ev): string {
  if (e.status === "PENDING") return "bg-amber-100 text-amber-900";
  if (e.status === "REJECTED" || e.status === "CANCELLED") return "bg-muted text-muted-foreground";
  if (e.leaveType === "HALF") return "bg-emerald-100 text-emerald-900";
  if (e.leaveType === "QUARTER") return "bg-violet-100 text-violet-900";
  return "bg-sky-100 text-sky-900"; // ANNUAL APPROVED
}

export function LeaveCalendar({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getUTCFullYear(), m: today.getUTCMonth() }); // m: 0-based
  const [creating, setCreating] = useState<string | null>(null);

  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const last = new Date(Date.UTC(cursor.y, cursor.m + 1, 0));
  const { data } = useQuery({
    queryKey: ["leave", "calendar", cursor.y, cursor.m],
    queryFn: async (): Promise<Ev[]> => {
      const res = await fetch(`/api/leave/calendar?start=${ymd(first)}&end=${ymd(last)}`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`calendar ${res.status}`);
      return (await res.json()).events as Ev[];
    },
  });
  const events = data ?? [];

  // 날짜별 이벤트(기간 걸침 포함)
  const eventsOn = (day: number) => {
    const key = ymd(new Date(Date.UTC(cursor.y, cursor.m, day)));
    return events.filter((e) => e.startDate.slice(0, 10) <= key && key <= e.endDate.slice(0, 10));
  };
  const daysInMonth = last.getUTCDate();
  const leadBlanks = first.getUTCDay(); // 0=일
  const cells: (number | null)[] = [...Array(leadBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const move = (delta: number) => setCursor((c) => { const d = new Date(Date.UTC(c.y, c.m + delta, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => move(-1)}>이전</Button>
        <Button size="sm" variant="outline" onClick={() => setCursor({ y: today.getUTCFullYear(), m: today.getUTCMonth() })}>오늘</Button>
        <Button size="sm" variant="outline" onClick={() => move(1)}>다음</Button>
        <span className="font-medium">{cursor.y}년 {cursor.m + 1}월</span>
        {canManage && <Button size="sm" className="ml-auto" onClick={() => setCreating("")}>+ 연차 입력</Button>}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-sm">
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => <div key={d} className="bg-muted p-2 text-center text-xs text-muted-foreground">{d}</div>)}
        {cells.map((day, i) => (
          <div key={i} className="min-h-20 bg-background p-1">
            {day && (
              <button type="button" className="mb-1 block w-full text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => router.push(`/leave/request?date=${ymd(new Date(Date.UTC(cursor.y, cursor.m, day)))}`)}>{day}</button>
            )}
            <div className="space-y-0.5">
              {day && eventsOn(day).map((e) => (
                <div key={e.id} className={cn("truncate rounded px-1 py-0.5 text-[11px]", colorFor(e))} title={`${e.name} · ${getFullLeaveText(e.leaveType, e.leaveSubType, e.quarterStartTime)}`}>
                  {e.name} {getFullLeaveText(e.leaveType, e.leaveSubType, e.quarterStartTime)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Card className="flex flex-wrap gap-3 p-3 text-xs text-muted-foreground">
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-sky-100 align-middle" />연차</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-emerald-100 align-middle" />반차</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-violet-100 align-middle" />반반차</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-amber-100 align-middle" />대기중</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-muted align-middle" />반려/취소</span>
      </Card>
      {creating !== null && <CreateLeaveModal onClose={() => setCreating(null)} />}
    </div>
  );
}
```

## Acceptance Criteria
- `npx vitest run tests/modules/leave/calendar-service.test.ts` → passed(부서 null self-only·마스킹·cross 전체).
- `npm run build` / `npm run typecheck` / `npm run lint` / `npm test` → 통과.
- 코드 점검: 일반 사용자 응답에 타인 PENDING/REJECTED 없음, 타인 항목 `reason=null`; `/calendar`(통합) 코드 무수정.

## Cautions
- **Don't** 부서 필터를 클라이언트에서만 적용하지 마라 — 서버 `where`가 권위다(클라 필터는 우회 가능).
- **Don't** 부서가 null인데 다른 null-부서 사용자와 묶지 마라(`department: null`로 in-그룹). self-only fail-closed — null끼리 매칭하면 무관한 사용자가 노출된다(spec finding).
- **Don't** 일반 사용자에게 타인의 PENDING/REJECTED를 보이지 마라(APPROVED만). 본인 것은 전 상태 노출.
- **Don't** 통합 캘린더(`/calendar`)나 `src/modules/calendar`를 수정하지 마라 — 독립 도메인.
