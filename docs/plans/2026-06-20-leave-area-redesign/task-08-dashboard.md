# Task 08 — 대시보드(service·API·page)

**목적:** 원본 `dashboard.service.ts`를 포팅한다. 일반 사용자는 본인 요약(총/사용/대기/잔여·사용률·이월·최근 5건), 관리자(`leave.status:view`/`leave.admin:view` 보유)는 cross-user 통계(전체 인원·오늘 휴가중·대기) + 오늘/내일/예정 휴가자 목록을 본다. `/leave`(대시보드 탭)를 교체.

## Files
- Create: `src/modules/leave/services/dashboard.ts`
- Create: `src/app/api/leave/dashboard/route.ts`
- Modify: `src/app/(app)/leave/page.tsx` (Task 04 임시 위젯 → 대시보드)
- Create: `src/app/(app)/leave/_components/dashboard-client.tsx`
- Create: `tests/modules/leave/dashboard-service.test.ts`

## Prep
- 엔트리포인트 §SC-2(대시보드 cross-user 게이트), §SC-1(getAllocationSummary·listRequests·rules.kstToday).
- 원본: `C:\workspace\annual-leave\backend\src\services\dashboard.service.ts`(getEmployeeDashboard/getAdminDashboard).
- 재사용: `getAllocationSummary(userId, year)`(`./allocations`, AllocationSummary 반환), `listRequests(filter)`(`../repositories`, deletedAt 필터는 Task 06 적용됨), `kstToday`(`../rules`).
- cross-schema: 휴가자 이름은 userId로 `prisma.user.findMany` 병합(Task 05와 동일).

## Deps
Task 01(필드), Task 02(labels — 클라이언트 표시). (Task 06의 deletedAt 필터가 있으면 통계 정확.)

## Steps

### 1. (TDD) dashboard service 테스트 → FAIL

`tests/modules/leave/dashboard-service.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { user: { count: vi.fn(), findMany: vi.fn() }, leaveRequest: { count: vi.fn(), findMany: vi.fn() } } }));
vi.mock("@/modules/leave/services/allocations", () => ({ getAllocationSummary: vi.fn() }));
vi.mock("@/modules/leave/repositories", () => ({ listRequests: vi.fn() }));

import { getEmployeeDashboard, getAdminDashboard } from "@/modules/leave/services/dashboard";
import { getAllocationSummary } from "@/modules/leave/services/allocations";
import { listRequests } from "@/modules/leave/repositories";
import { prisma } from "@/lib/prisma";

beforeEach(() => vi.clearAllMocks());

describe("getEmployeeDashboard", () => {
  it("사용률 = round(used/total*100), 최근 5건", async () => {
    vi.mocked(getAllocationSummary).mockResolvedValue({ year: 2026, allocatedDays: 15, carriedOverDays: 0, totalDays: 15, usedDays: 3, pendingDays: 0, remainingDays: 12, carriedOverExpiryDate: null });
    vi.mocked(listRequests).mockResolvedValue(Array.from({ length: 7 }, (_, i) => ({ id: `r${i}` })) as never);
    const out = await getEmployeeDashboard("u1");
    expect(out.usageRate).toBe(20);
    expect(out.recentRequests).toHaveLength(5);
  });
  it("할당 없으면 usageRate 0", async () => {
    vi.mocked(getAllocationSummary).mockResolvedValue(null);
    vi.mocked(listRequests).mockResolvedValue([] as never);
    const out = await getEmployeeDashboard("u1");
    expect(out.usageRate).toBe(0);
    expect(out.summary).toBeNull();
  });
});

describe("getAdminDashboard", () => {
  it("전체 인원·오늘 휴가중·대기 카운트", async () => {
    vi.mocked(prisma.user.count).mockResolvedValue(10 as never);
    vi.mocked(prisma.leaveRequest.count).mockResolvedValueOnce(2 as never).mockResolvedValueOnce(3 as never); // todayOnLeave, pending
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    const out = await getAdminDashboard();
    expect(out.totalEmployees).toBe(10);
    expect(out.todayOnLeave).toBe(2);
    expect(out.pendingRequests).toBe(3);
  });
});
```
실행 → **FAIL**.

### 2. dashboard service 구현 → PASS

`src/modules/leave/services/dashboard.ts`:
```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { getAllocationSummary } from "./allocations";
import { listRequests } from "../repositories";
import { kstToday } from "../rules";
import type { AllocationSummary } from "../types";

export interface EmployeeDashboard {
  summary: AllocationSummary | null;
  usageRate: number;
  recentRequests: Awaited<ReturnType<typeof listRequests>>;
}

export async function getEmployeeDashboard(userId: string): Promise<EmployeeDashboard> {
  const year = kstToday(new Date()).getUTCFullYear();
  const summary = await getAllocationSummary(userId, year);
  const all = await listRequests({ userId });
  const recentRequests = all.slice(0, 5);
  const usageRate = summary && summary.totalDays > 0 ? Math.round((summary.usedDays / summary.totalDays) * 100) : 0;
  return { summary, usageRate, recentRequests };
}

export interface LeavePerson { userId: string; name: string; leaveType: string; leaveSubType: string | null; quarterStartTime: string | null; startDate: Date; endDate: Date; }
export interface AdminDashboard {
  totalEmployees: number; todayOnLeave: number; pendingRequests: number;
  today: LeavePerson[]; tomorrow: LeavePerson[]; upcoming: LeavePerson[];
}

async function approvedCovering(from: Date, to: Date): Promise<LeavePerson[]> {
  // [from,to] 구간과 겹치는 APPROVED(삭제 제외) 휴가 + 이름 병합.
  const items = await prisma.leaveRequest.findMany({
    where: { status: "APPROVED", deletedAt: null, AND: [{ startDate: { lte: to } }, { endDate: { gte: from } }] },
    select: { userId: true, leaveType: true, leaveSubType: true, quarterStartTime: true, startDate: true, endDate: true },
    orderBy: { startDate: "asc" },
  });
  if (items.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.userId))] } }, select: { id: true, name: true } });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return items.map((i) => ({ ...i, name: nameById.get(i.userId) ?? i.userId }));
}

export async function getAdminDashboard(): Promise<AdminDashboard> {
  const today = kstToday(new Date());
  const day = 24 * 60 * 60 * 1000;
  const tomorrow = new Date(today.getTime() + day);
  const weekEnd = new Date(today.getTime() + 7 * day);

  const [totalEmployees, todayOnLeave, pendingRequests, todayList, tomorrowList, upcomingList] = await Promise.all([
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.leaveRequest.count({ where: { status: "APPROVED", deletedAt: null, AND: [{ startDate: { lte: today } }, { endDate: { gte: today } }] } }),
    prisma.leaveRequest.count({ where: { status: "PENDING", deletedAt: null } }),
    approvedCovering(today, today),
    approvedCovering(tomorrow, tomorrow),
    approvedCovering(new Date(today.getTime() + 2 * day), weekEnd), // 모레~+7일
  ]);
  return { totalEmployees, todayOnLeave, pendingRequests, today: todayList, tomorrow: tomorrowList, upcoming: upcomingList };
}
```
실행: 1번 → **PASS**.

### 3. API 라우트

`src/app/api/leave/dashboard/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission, getPermissionSummary } from "@/kernel/access";
import { getEmployeeDashboard, getAdminDashboard } from "@/modules/leave/services/dashboard";
import { mapError } from "@/app/api/leave/_shared";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    await requirePermission(session.user.id, "leave.request", "view"); // 진입(본인 요약)
    const employee = await getEmployeeDashboard(session.user.id);
    const keys = new Set((await getPermissionSummary(session.user.id)).keys);
    const showAdmin = keys.has("leave.status:view") || keys.has("leave.admin:view"); // cross-user 게이트(approval:view 불가)
    const admin = showAdmin ? await getAdminDashboard() : null;
    return NextResponse.json({ employee, admin }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
```

### 4. page + client

`src/app/(app)/leave/page.tsx` 교체:
```tsx
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { DashboardClient } from "./_components/dashboard-client";

export default async function LeavePage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  if (!new Set(keys).has("leave.request:view")) return <p className="text-sm text-muted-foreground">연차 열람 권한이 없습니다.</p>;
  return <DashboardClient />;
}
```

`src/app/(app)/leave/_components/dashboard-client.tsx`:
```tsx
"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getFullLeaveText, TYPE_LABEL } from "@/modules/leave/labels";

interface Summary { allocatedDays: number; carriedOverDays: number; totalDays: number; usedDays: number; pendingDays: number; remainingDays: number; }
interface Recent { id: string; leaveType: string; startDate: string; endDate: string; status: string; }
interface Person { userId: string; name: string; leaveType: string; leaveSubType: string | null; quarterStartTime: string | null; startDate: string; endDate: string; }
interface AdminBlock { totalEmployees: number; todayOnLeave: number; pendingRequests: number; today: Person[]; tomorrow: Person[]; upcoming: Person[]; }
interface Resp { employee: { summary: Summary | null; usageRate: number; recentRequests: Recent[] }; admin: AdminBlock | null; }

async function fetchDashboard(): Promise<Resp> {
  const res = await fetch("/api/leave/dashboard", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`dashboard ${res.status}`);
  return res.json();
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">{label}</span><span className="text-2xl font-semibold tabular-nums">{value}</span></div>
);
const PeopleList = ({ title, people }: { title: string; people: Person[] }) => (
  <Card className="space-y-2 p-4">
    <h3 className="text-sm font-medium">{title}</h3>
    {people.length === 0 ? <p className="text-sm text-muted-foreground">없음</p> : (
      <ul className="space-y-1 text-sm">{people.map((p, i) => <li key={`${p.userId}-${i}`}>{p.name} · {getFullLeaveText(p.leaveType, p.leaveSubType, p.quarterStartTime)}</li>)}</ul>
    )}
  </Card>
);

export function DashboardClient() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["leave", "dashboard"], queryFn: fetchDashboard });
  if (isLoading) return <Card className="p-4 text-sm text-muted-foreground">불러오는 중…</Card>;
  if (isError || !data) return <Card className="p-4 text-sm text-destructive">대시보드를 불러오지 못했습니다.</Card>;
  const s = data.employee.summary;
  return (
    <div className="space-y-6">
      {!s ? (
        <Card className="p-4 text-sm text-muted-foreground">{new Date().getFullYear()}년 연차 할당이 설정되지 않았습니다. 관리자에게 문의하세요.</Card>
      ) : (
        <>
          <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <Stat label="총 연차" value={`${s.totalDays}일`} />
            <Stat label="사용" value={`${s.usedDays}일`} />
            <Stat label="대기" value={`${s.pendingDays}일`} />
            <Stat label="잔여" value={`${s.remainingDays}일`} />
          </Card>
          <Card className="space-y-2 p-4">
            <div className="flex justify-between text-sm"><span>사용률</span><span className="tabular-nums">{data.employee.usageRate}% ({s.usedDays}/{s.totalDays})</span></div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, data.employee.usageRate)}%` }} /></div>
            {s.carriedOverDays > 0 && <p className="text-sm text-muted-foreground">이월 연차 {s.carriedOverDays}일이 있습니다.</p>}
          </Card>
        </>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between"><h2 className="font-medium">최근 신청 내역</h2><Link href="/leave/history" className="text-sm text-muted-foreground hover:text-foreground">전체 보기</Link></div>
        {data.employee.recentRequests.length === 0 ? <p className="text-sm text-muted-foreground">신청 내역이 없습니다.</p> : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {data.employee.recentRequests.map((r) => (
              <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
                <Badge variant="outline">{TYPE_LABEL[r.leaveType] ?? r.leaveType}</Badge>
                <span>{new Date(r.startDate).toLocaleDateString("ko-KR")}</span>
                <span className="ml-auto text-muted-foreground">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.admin && (
        <div className="space-y-3">
          <h2 className="font-medium">전체 현황</h2>
          <Card className="grid grid-cols-3 gap-4 p-4">
            <Stat label="전체 인원" value={`${data.admin.totalEmployees}명`} />
            <Stat label="오늘 휴가중" value={`${data.admin.todayOnLeave}명`} />
            <Stat label="대기 중 신청" value={`${data.admin.pendingRequests}건`} />
          </Card>
          <div className="grid gap-3 sm:grid-cols-3">
            <PeopleList title="오늘" people={data.admin.today} />
            <PeopleList title="내일" people={data.admin.tomorrow} />
            <PeopleList title="예정(7일)" people={data.admin.upcoming} />
          </div>
        </div>
      )}
    </div>
  );
}
```

## Acceptance Criteria
- `npx vitest run tests/modules/leave/dashboard-service.test.ts` → passed.
- `npm run build` / `npm run typecheck` / `npm run lint` / `npm test` → 통과.
- 코드 점검: `/api/leave/dashboard`의 admin 블록이 `leave.status:view`/`leave.admin:view` 보유 시에만 채워짐(`leave.approval:view`만으론 null).

## Cautions
- **Don't** cross-user 통계(admin 블록)를 `leave.approval:view`로 노출하지 마라. 이유: 타인 연차 가시성은 status/admin 권한으로만(spec §4 finding).
- **Don't** 휴가자 집계에서 `deletedAt`/`status` 조건을 빼지 마라. 이유: soft-delete·취소분이 "오늘 휴가중"에 잡힌다.
- **Don't** `recentRequests`에 관리자 전체를 넣지 마라 — 본인(`userId` 필터) 5건이다.
