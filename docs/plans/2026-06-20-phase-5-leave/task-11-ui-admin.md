# Task 11 — UI (관리자 /admin/leave) + 데모 시드

**Purpose:** 관리자 화면 — 승인 대기 목록(승인/반려), 연도별 할당 관리(설정·조정·recalculate·이력)·공휴일 수동 sync 버튼. + dev 데모 시드(할당)로 화면 시연.

## Files
- Create: `src/app/(app)/admin/leave/approvals/page.tsx`
- Create: `src/app/(app)/admin/leave/approvals/approvals-client.tsx`
- Create: `src/app/(app)/admin/leave/allocations/page.tsx`
- Create: `src/app/(app)/admin/leave/allocations/allocations-client.tsx`
- Modify: `prisma/seed-demo.ts` (데모 LeaveAllocation 추가)

## Prep
- spec §10 / entrypoint §SC-8.
- 패턴: 직원 UI(task 10) 동일. 서버 page에서 권한 체크(`leave.approval:view`/`leave.allocation:view`), client는 useQuery/useMutation.
- 라벨은 `@/app/(app)/leave/labels`(task 10) 재사용.

## Deps
- 09 (관리자 API).

## Steps

### 1. approvals
`src/app/(app)/admin/leave/approvals/page.tsx`:

```tsx
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { ApprovalsClient } from "./approvals-client";

export default async function ApprovalsPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const canView = new Set(keys).has("leave.approval:view");
  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">연차 승인</h1>
      {!canView ? <p className="text-sm text-muted-foreground">승인 권한이 없습니다.</p> : <ApprovalsClient />}
    </section>
  );
}
```

`src/app/(app)/admin/leave/approvals/approvals-client.tsx`:

```tsx
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TYPE_LABEL } from "@/app/(app)/leave/labels";

interface Req { id: string; userId: string; leaveType: string; startDate: string; endDate: string; days: string; reason: string | null; user?: { name: string }; }

async function fetchPending(): Promise<Req[]> {
  const res = await fetch("/api/admin/leave/requests?status=PENDING", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`pending ${res.status}`);
  return (await res.json()).items as Req[];
}
async function act(id: string, kind: "approve" | "reject", rejectionReason?: string) {
  const res = await fetch(`/api/admin/leave/requests/${id}/${kind}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: kind === "reject" ? JSON.stringify({ rejectionReason }) : "{}",
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${kind} 실패 (${res.status})`);
}

export function ApprovalsClient() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["admin-leave", "pending"], queryFn: fetchPending });
  const m = useMutation({
    mutationFn: (v: { id: string; kind: "approve" | "reject" }) => act(v.id, v.kind, v.kind === "reject" ? "반려" : undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-leave"] }),
  });
  const fmt = (s: string) => new Date(s).toLocaleDateString("ko-KR");

  if (isLoading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">대기 중인 신청이 없습니다.</p>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {data.map((r) => (
        <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
          <span className="font-medium">{r.user?.name ?? r.userId}</span>
          <Badge variant="outline">{TYPE_LABEL[r.leaveType] ?? r.leaveType}</Badge>
          <span>{fmt(r.startDate)}{r.endDate !== r.startDate ? ` ~ ${fmt(r.endDate)}` : ""}</span>
          <span className="text-muted-foreground tabular-nums">{Number(r.days)}일</span>
          <div className="ml-auto flex gap-1">
            <Button size="sm" disabled={m.isPending} onClick={() => m.mutate({ id: r.id, kind: "approve" })}>승인</Button>
            <Button size="sm" variant="ghost" disabled={m.isPending} onClick={() => m.mutate({ id: r.id, kind: "reject" })}>반려</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

### 2. allocations (+ 공휴일 sync 버튼)
`src/app/(app)/admin/leave/allocations/page.tsx`:

```tsx
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { AllocationsClient } from "./allocations-client";

export default async function AllocationsPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const set = new Set(keys);
  const canView = set.has("leave.allocation:view");
  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">연차 할당</h1>
      {!canView ? <p className="text-sm text-muted-foreground">할당 열람 권한이 없습니다.</p>
        : <AllocationsClient canConfigure={set.has("leave.allocation:configure")} />}
    </section>
  );
}
```

`src/app/(app)/admin/leave/allocations/allocations-client.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface Alloc { id: string; userId: string; allocatedDays: string; carriedOverDays: string; usedDays: string; }

async function fetchAllocations(year: number): Promise<Alloc[]> {
  const res = await fetch(`/api/admin/leave/allocations?year=${year}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`allocations ${res.status}`);
  return (await res.json()).items as Alloc[];
}
async function post(url: string) {
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `요청 실패 (${res.status})`);
  return res.json();
}

async function putAllocation(userId: string, year: number, body: { allocatedDays: number; carriedOverDays: number }) {
  const res = await fetch(`/api/admin/leave/allocations/${userId}/${year}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `설정 실패 (${res.status})`);
}

export function AllocationsClient({ canConfigure }: { canConfigure: boolean }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [form, setForm] = useState({ userId: "", allocatedDays: "15", carriedOverDays: "0" });
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["admin-leave", "allocations", year], queryFn: () => fetchAllocations(year) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-leave", "allocations", year] });
  const recalc = useMutation({
    mutationFn: (userId: string) => post(`/api/admin/leave/allocations/${userId}/${year}/recalculate`),
    onSuccess: invalidate,
  });
  const setAlloc = useMutation({
    mutationFn: () => putAllocation(form.userId, year, { allocatedDays: Number(form.allocatedDays), carriedOverDays: Number(form.carriedOverDays) }),
    onSuccess: () => { setForm({ userId: "", allocatedDays: "15", carriedOverDays: "0" }); invalidate(); },
  });
  const syncHolidays = useMutation({ mutationFn: () => post(`/api/admin/leave/holidays/sync?year=${year}`) });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input type="number" className="w-28" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} />
        {canConfigure && (
          <Button size="sm" variant="outline" disabled={syncHolidays.isPending} onClick={() => syncHolidays.mutate()}>
            {syncHolidays.isPending ? "동기화 중…" : `${year}년 공휴일 동기화`}
          </Button>
        )}
        {syncHolidays.isSuccess && <span className="text-sm text-muted-foreground">공휴일 {(syncHolidays.data as { count: number }).count}건</span>}
      </div>

      {canConfigure && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1"><span className="text-xs text-muted-foreground">사용자 ID</span>
            <Input className="w-56" value={form.userId} onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))} placeholder="userId" /></div>
          <div className="space-y-1"><span className="text-xs text-muted-foreground">할당일</span>
            <Input type="number" className="w-24" value={form.allocatedDays} onChange={(e) => setForm((f) => ({ ...f, allocatedDays: e.target.value }))} /></div>
          <div className="space-y-1"><span className="text-xs text-muted-foreground">이월일</span>
            <Input type="number" className="w-24" value={form.carriedOverDays} onChange={(e) => setForm((f) => ({ ...f, carriedOverDays: e.target.value }))} /></div>
          <Button size="sm" disabled={setAlloc.isPending || !form.userId} onClick={() => setAlloc.mutate()}>{year}년 할당 설정</Button>
          {setAlloc.isError && <span className="text-sm text-destructive">{(setAlloc.error as Error).message}</span>}
        </Card>
      )}

      {isLoading ? <p className="text-sm text-muted-foreground">불러오는 중…</p>
        : data.length === 0 ? <Card className="p-4 text-sm text-muted-foreground">{year}년 할당이 없습니다.</Card>
        : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 p-3 text-sm">
              <span className="font-medium">{a.userId}</span>
              <span className="text-muted-foreground tabular-nums">할당 {Number(a.allocatedDays)} · 이월 {Number(a.carriedOverDays)} · 사용 {Number(a.usedDays)}</span>
              {canConfigure && (
                <Button size="sm" variant="ghost" className="ml-auto" disabled={recalc.isPending} onClick={() => recalc.mutate(a.userId)}>사용일 재계산</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

> 할당 행은 `userId`를 표시한다(사용자명 join은 후속). 설정(PUT)·재계산(recalculate)·공휴일 동기화는 본 태스크에서 노출한다. **조정(adjust, 이력 동반)** 폼은 같은 패턴으로 후속 확장한다(API는 task 09에 존재).

### 3. 데모 시드
`prisma/seed-demo.ts`에 데모 사용자(admin) 현재연도 `LeaveAllocation` upsert를 추가(이미 LeaveRequest 데모가 있으면 그 사용자 기준):

```ts
const demoYear = new Date().getFullYear();
await prisma.leaveAllocation.upsert({
  where: { userId_year: { userId: admin.id, year: demoYear } },
  update: {},
  create: { userId: admin.id, year: demoYear, allocatedDays: 15, carriedOverDays: 3, usedDays: 0 },
});
```

(seed-demo의 기존 admin 사용자 id 변수에 맞춰 `admin.id`를 사용. 없으면 데모 사용자 조회 후 사용.)

### 4. 검증·커밋
```
npm run lint && npm run typecheck && npm run build
git add "src/app/(app)/admin/leave" prisma/seed-demo.ts
git commit -m "feat(leave): 관리자 연차 UI(승인·할당·공휴일 sync)·데모 시드"
```

## Acceptance Criteria
- `npm run typecheck` / `npm run lint` / `npm run build` → 그린.
- (dev) `/admin/leave/approvals`에서 대기 신청 승인/반려, `/admin/leave/allocations`에서 연도별 할당·재계산·공휴일 동기화 동작.

## Cautions
- **Don't 비-configure 사용자에게 변경 버튼을 노출하지 말 것.** Reason: `canConfigure`(useCan과 동일 키)로 가린다. 서버 라우트도 동일 키 검사(이중 방어).
- **Don't 승인/반려 후 수동 refetch하지 말 것.** Reason: `["admin-leave"]` 무효화로 목록 갱신.
- **Don't 데모 시드를 운영 seed.ts에 넣지 말 것.** Reason: 데모 데이터는 `seed-demo.ts`(dev 전용)에만.
