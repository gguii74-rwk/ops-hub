# Task 09 — 연차 현황 + 엑셀(service·API·export·page)

**목적:** 원본 `getAllEmployeesStatus`와 엑셀 내보내기를 포팅한다. 전체 직원 표(이름·이메일·부서·총·사용·대기·잔여) + 부서 필터·이름 검색 + 잔여 색상 강조 + `leave-status-YYYY.xlsx` 다운로드.

## Files
- Create: `src/modules/leave/services/status.ts`
- Create: `src/app/api/admin/leave/status/route.ts`
- Create: `src/app/api/admin/leave/status/export/route.ts`
- Modify: `src/app/(app)/leave/status/page.tsx` (Task 04 stub → 실제)
- Create: `src/app/(app)/leave/_components/status-client.tsx`
- Create: `tests/modules/leave/status-service.test.ts`

## Prep
- 엔트리포인트 §SC-2(현황·엑셀=`leave.status:view`), §SC-1(parseYear).
- 원본: `C:\workspace\annual-leave\backend\src\services\dashboard.service.ts`(getAllEmployeesStatus), `excel.service.ts`(컬럼).
- `exceljs@^4.4.0`는 의존성에 있으나 **기존 사용처 없음**(첫 사용).
- User 필드: `status`, `name`, `email`, `department`. LeaveAllocation: `allocatedDays/carriedOverDays/usedDays`(Decimal).

## Deps
Task 01(권한 catalog leave.status), Task 02(없어도 무방).

## Steps

### 1. (TDD) status service 테스트 → FAIL

`tests/modules/leave/status-service.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: vi.fn() }, leaveAllocation: { findMany: vi.fn() }, leaveRequest: { groupBy: vi.fn() } } }));
import { getAllEmployeesStatus } from "@/modules/leave/services/status";
import { prisma } from "@/lib/prisma";
beforeEach(() => vi.clearAllMocks());

describe("getAllEmployeesStatus", () => {
  it("할당·대기 병합 후 잔여 계산", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u1", name: "김", email: "k@x.com", department: "개발" }] as never);
    vi.mocked(prisma.leaveAllocation.findMany).mockResolvedValue([{ userId: "u1", allocatedDays: 15, carriedOverDays: 2, usedDays: 5 }] as never);
    vi.mocked(prisma.leaveRequest.groupBy).mockResolvedValue([{ userId: "u1", _sum: { days: 1 } }] as never);
    const out = await getAllEmployeesStatus(2026);
    expect(out[0]).toMatchObject({ name: "김", totalDays: 17, usedDays: 5, pendingDays: 1, remainingDays: 11 });
  });
  it("할당 없는 사용자는 0/0/0", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u2", name: "이", email: "l@x.com", department: null }] as never);
    vi.mocked(prisma.leaveAllocation.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.leaveRequest.groupBy).mockResolvedValue([] as never);
    const out = await getAllEmployeesStatus(2026);
    expect(out[0]).toMatchObject({ totalDays: 0, usedDays: 0, pendingDays: 0, remainingDays: 0 });
  });
});
```
실행 → **FAIL**.

### 2. status service 구현 → PASS

`src/modules/leave/services/status.ts`:
```ts
import "server-only";
import { prisma } from "@/lib/prisma";

export interface EmployeeStatus { id: string; name: string; email: string; department: string | null; totalDays: number; usedDays: number; pendingDays: number; remainingDays: number; }

export async function getAllEmployeesStatus(year: number): Promise<EmployeeStatus[]> {
  const [users, allocs, pendings] = await Promise.all([
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, email: true, department: true }, orderBy: { name: "asc" } }),
    prisma.leaveAllocation.findMany({ where: { year }, select: { userId: true, allocatedDays: true, carriedOverDays: true, usedDays: true } }),
    prisma.leaveRequest.groupBy({
      by: ["userId"],
      where: { status: "PENDING", deletedAt: null, startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } },
      _sum: { days: true },
    }),
  ]);
  const allocById = new Map(allocs.map((a) => [a.userId, a]));
  const pendById = new Map(pendings.map((p) => [p.userId, p._sum.days ? Number(p._sum.days) : 0]));
  return users.map((u) => {
    const a = allocById.get(u.id);
    const totalDays = a ? Number(a.allocatedDays) + Number(a.carriedOverDays) : 0;
    const usedDays = a ? Number(a.usedDays) : 0;
    const pendingDays = pendById.get(u.id) ?? 0;
    return { id: u.id, name: u.name, email: u.email, department: u.department, totalDays, usedDays, pendingDays, remainingDays: totalDays - usedDays - pendingDays };
  });
}
```
실행: 1번 → **PASS**.

### 3. status JSON 라우트
`src/app/api/admin/leave/status/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { getAllEmployeesStatus } from "@/modules/leave/services/status";
import { mapError, parseYear } from "@/app/api/leave/_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear(new URL(req.url).searchParams.get("year"));
  try {
    await requirePermission(session.user.id, "leave.status", "view");
    const items = await getAllEmployeesStatus(year);
    return NextResponse.json({ year, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
```

### 4. 엑셀 export 라우트
`src/app/api/admin/leave/status/export/route.ts`:
```ts
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { getAllEmployeesStatus } from "@/modules/leave/services/status";
import { mapError, parseYear } from "@/app/api/leave/_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear(new URL(req.url).searchParams.get("year"));
  try {
    await requirePermission(session.user.id, "leave.status", "view");
    const rows = await getAllEmployeesStatus(year);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${year} 연차현황`);
    ws.columns = [
      { header: "이름", key: "name", width: 15 },
      { header: "이메일", key: "email", width: 30 },
      { header: "부서", key: "department", width: 15 },
      { header: "총 연차", key: "totalDays", width: 12 },
      { header: "사용 연차", key: "usedDays", width: 12 },
      { header: "대기 중", key: "pendingDays", width: 12 },
      { header: "잔여 연차", key: "remainingDays", width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach((r) => ws.addRow({ ...r, department: r.department ?? "-" }));
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="leave-status-${year}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return mapError(error);
  }
}
```

### 5. page + client
`src/app/(app)/leave/status/page.tsx` 교체(stub → 실제):
```tsx
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { StatusClient } from "../_components/status-client";

export default async function LeaveStatusPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  if (!new Set(keys).has("leave.status:view")) return <p className="text-sm text-muted-foreground">연차 현황 권한이 없습니다.</p>;
  return <StatusClient />;
}
```
`src/app/(app)/leave/_components/status-client.tsx`:
```tsx
"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Row { id: string; name: string; email: string; department: string | null; totalDays: number; usedDays: number; pendingDays: number; remainingDays: number; }

async function fetchStatus(year: number): Promise<{ items: Row[] }> {
  const res = await fetch(`/api/admin/leave/status?year=${year}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export function StatusClient() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [dept, setDept] = useState("");
  const [q, setQ] = useState("");
  const { data, isLoading, isError } = useQuery({ queryKey: ["admin-leave", "status", year], queryFn: () => fetchStatus(year) });
  const rows = data?.items ?? [];
  const depts = useMemo(() => [...new Set(rows.map((r) => r.department).filter(Boolean) as string[])], [rows]);
  const filtered = rows.filter((r) => (!dept || r.department === dept) && (!q || r.name.includes(q)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="number" className="w-28" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} />
        <select className="h-9 rounded-md border border-border bg-background px-3 text-sm" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">전체 부서</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <Input className="w-40" placeholder="이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        {/* Button은 asChild 미지원(native button props만) → buttonVariants로 스타일한 <a> 사용 */}
        <a href={`/api/admin/leave/status/export?year=${year}`} className={buttonVariants({ variant: "outline", size: "sm" })}>엑셀 내보내기</a>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">불러오는 중…</p> : isError ? <p className="text-sm text-destructive">불러오지 못했습니다.</p> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr><th className="p-2">이름</th><th className="p-2">부서</th><th className="p-2 text-right">총</th><th className="p-2 text-right">사용</th><th className="p-2 text-right">대기</th><th className="p-2 text-right">잔여</th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-2">{r.name}</td>
                  <td className="p-2 text-muted-foreground">{r.department ?? "-"}</td>
                  <td className="p-2 text-right tabular-nums">{r.totalDays}</td>
                  <td className="p-2 text-right tabular-nums">{r.usedDays}</td>
                  <td className="p-2 text-right tabular-nums">{r.pendingDays}</td>
                  <td className={cn("p-2 text-right tabular-nums font-medium", r.remainingDays < 3 ? "text-destructive" : r.remainingDays < 7 ? "text-amber-600" : "text-foreground")}>{r.remainingDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```
**주의:** 프로젝트 `button.tsx`는 `asChild`를 **지원하지 않는다**(native button props만). 그래서 위처럼 `buttonVariants({...})`로 스타일한 `<a>`를 쓴다(브라우저 기본 다운로드 동작 유지). `<Button asChild>`를 쓰면 typecheck/렌더가 깨진다.

## Acceptance Criteria
- `npx vitest run tests/modules/leave/status-service.test.ts` → passed.
- `npm run build` / `npm run typecheck` / `npm run lint` / `npm test` → 통과.
- (수동) `/leave/status`에서 엑셀 버튼 클릭 시 `leave-status-2026.xlsx` 다운로드(헤더 7열).

## Cautions
- **Don't** 엑셀 응답에서 `Content-Disposition`을 빼지 마라 — 브라우저가 파일로 저장하지 않고 본다.
- **Don't** `wb.xlsx.writeBuffer()` 결과를 그대로 `NextResponse.json`에 넣지 마라 — 바이너리는 `new NextResponse(buf, {headers})`로. exceljs 버퍼 타입은 `as ArrayBuffer` 캐스팅 필요할 수 있다.
- **Don't** 현황 집계에 비활성 사용자/삭제분을 포함하지 마라(`status: ACTIVE`, pending은 `deletedAt: null`).
