# Task 10 — UI (직원 /leave)

**Purpose:** 직원 연차 화면 — 내 연차 요약 카드 + 신청 폼 + 내 신청 이력(취소). React Query로 조회·변경, 변경 후 `["leave"]` 무효화로 요약·목록 동기 갱신.

## Files
- Create: `src/app/(app)/leave/labels.ts`
- Create: `src/app/(app)/leave/leave-summary.tsx`
- Create: `src/app/(app)/leave/leave-request-form.tsx`
- Create: `src/app/(app)/leave/my-requests.tsx`
- Create: `src/app/(app)/leave/page.tsx`

## Prep
- spec §10 / entrypoint §SC-8.
- 패턴: workflows `page.tsx`(서버 권한 체크) + `workflows-list.tsx`(client useQuery) + `labels.ts`. ui 프리미티브: badge/button/card/input/label/textarea. select는 네이티브 `<select>`. `useCan`(`@/lib/auth/permissions-client`).
- badge variant: default/secondary/outline/destructive.

## Deps
- 08 (직원 API).

## Steps

### 1. labels.ts
`src/app/(app)/leave/labels.ts`:

```ts
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

export const TYPE_LABEL: Record<string, string> = { ANNUAL: "연차", HALF: "반차", QUARTER: "반반차" };
export const SUBTYPE_LABEL: Record<string, string> = { MORNING: "오전", AFTERNOON: "오후" };
export const STATUS_LABEL: Record<LeaveStatus, string> = { PENDING: "대기", APPROVED: "승인", REJECTED: "반려", CANCELLED: "취소" };
export const STATUS_VARIANT: Record<LeaveStatus, BadgeVariant> = {
  PENDING: "outline", APPROVED: "default", REJECTED: "destructive", CANCELLED: "secondary",
};
```

### 2. leave-summary.tsx
`src/app/(app)/leave/leave-summary.tsx`:

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";

interface Summary {
  year: number; allocatedDays: number; carriedOverDays: number; totalDays: number;
  usedDays: number; pendingDays: number; remainingDays: number; carriedOverExpiryDate: string | null;
}

async function fetchSummary(): Promise<Summary | null> {
  const res = await fetch("/api/leave/summary", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`summary ${res.status}`);
  return (await res.json()).summary as Summary | null;
}

const Cell = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-lg font-semibold tabular-nums">{value}</span>
  </div>
);

export function LeaveSummary() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["leave", "summary"], queryFn: fetchSummary });
  if (isLoading) return <Card className="p-4 text-sm text-muted-foreground">불러오는 중…</Card>;
  if (isError) return <Card className="p-4 text-sm text-destructive">요약을 불러오지 못했습니다.</Card>;
  if (!data) return <Card className="p-4 text-sm text-muted-foreground">{new Date().getFullYear()}년 연차 할당이 설정되지 않았습니다. 관리자에게 문의하세요.</Card>;
  const d = (n: number) => `${n}일`;
  return (
    <Card className="grid grid-cols-3 gap-4 p-4 sm:grid-cols-6">
      <Cell label="할당" value={d(data.allocatedDays)} />
      <Cell label="이월" value={d(data.carriedOverDays)} />
      <Cell label="총" value={d(data.totalDays)} />
      <Cell label="사용" value={d(data.usedDays)} />
      <Cell label="대기" value={d(data.pendingDays)} />
      <Cell label="잔여" value={d(data.remainingDays)} />
    </Card>
  );
}
```

### 3. leave-request-form.tsx
`src/app/(app)/leave/leave-request-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type LeaveType = "ANNUAL" | "HALF" | "QUARTER";
interface FormState { leaveType: LeaveType; leaveSubType: "MORNING" | "AFTERNOON"; quarterStartTime: string; startDate: string; endDate: string; reason: string; }
const initial: FormState = { leaveType: "ANNUAL", leaveSubType: "MORNING", quarterStartTime: "09:00", startDate: "", endDate: "", reason: "" };

async function submit(state: FormState) {
  const single = state.leaveType !== "ANNUAL";
  const body = {
    leaveType: state.leaveType,
    leaveSubType: state.leaveType === "HALF" ? state.leaveSubType : undefined,
    quarterStartTime: state.leaveType === "QUARTER" ? state.quarterStartTime : undefined,
    startDate: state.startDate,
    endDate: single ? state.startDate : state.endDate,
    reason: state.reason || undefined,
  };
  const res = await fetch("/api/leave/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `신청 실패 (${res.status})`);
}

export function LeaveRequestForm() {
  const [state, setState] = useState<FormState>(initial);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => submit(state),
    onSuccess: () => { setState(initial); qc.invalidateQueries({ queryKey: ["leave"] }); },
  });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setState((s) => ({ ...s, [k]: v }));
  const single = state.leaveType !== "ANNUAL";

  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-medium">연차 신청</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="lt">유형</Label>
          <select id="lt" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={state.leaveType} onChange={(e) => set("leaveType", e.target.value as LeaveType)}>
            <option value="ANNUAL">연차</option>
            <option value="HALF">반차(0.5)</option>
            <option value="QUARTER">반반차(0.25)</option>
          </select>
        </div>
        {state.leaveType === "HALF" && (
          <div className="space-y-1">
            <Label htmlFor="st">반차 시간대</Label>
            <select id="st" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={state.leaveSubType} onChange={(e) => set("leaveSubType", e.target.value as "MORNING" | "AFTERNOON")}>
              <option value="MORNING">오전</option>
              <option value="AFTERNOON">오후</option>
            </select>
          </div>
        )}
        {state.leaveType === "QUARTER" && (
          <div className="space-y-1">
            <Label htmlFor="qt">시작 시각</Label>
            <Input id="qt" type="time" value={state.quarterStartTime} onChange={(e) => set("quarterStartTime", e.target.value)} />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="sd">{single ? "날짜" : "시작일"}</Label>
          <Input id="sd" type="date" value={state.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </div>
        {!single && (
          <div className="space-y-1">
            <Label htmlFor="ed">종료일</Label>
            <Input id="ed" type="date" value={state.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </div>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor="rs">사유(선택)</Label>
        <Textarea id="rs" value={state.reason} onChange={(e) => set("reason", e.target.value)} rows={2} />
      </div>
      {m.isError && <p className="text-sm text-destructive">{(m.error as Error).message}</p>}
      <Button disabled={m.isPending || !state.startDate || (!single && !state.endDate)} onClick={() => m.mutate()}>
        {m.isPending ? "신청 중…" : "신청"}
      </Button>
    </Card>
  );
}
```

### 4. my-requests.tsx
`src/app/(app)/leave/my-requests.tsx`:

```tsx
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TYPE_LABEL, STATUS_LABEL, STATUS_VARIANT, type LeaveStatus } from "./labels";

interface Req { id: string; leaveType: string; startDate: string; endDate: string; days: string; status: LeaveStatus; reason: string | null; }

async function fetchMine(): Promise<Req[]> {
  const res = await fetch("/api/leave/requests", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`requests ${res.status}`);
  return (await res.json()).items as Req[];
}
async function cancelReq(id: string) {
  const res = await fetch(`/api/leave/requests/${id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `취소 실패 (${res.status})`);
}

export function MyRequests() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["leave", "requests"], queryFn: fetchMine });
  const cancel = useMutation({ mutationFn: cancelReq, onSuccess: () => qc.invalidateQueries({ queryKey: ["leave"] }) });
  const fmt = (s: string) => new Date(s).toLocaleDateString("ko-KR");

  if (isLoading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">신청 내역이 없습니다.</p>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {data.map((r) => (
        <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
          <Badge variant="outline">{TYPE_LABEL[r.leaveType] ?? r.leaveType}</Badge>
          <span>{fmt(r.startDate)}{r.endDate !== r.startDate ? ` ~ ${fmt(r.endDate)}` : ""}</span>
          <span className="text-muted-foreground tabular-nums">{Number(r.days)}일</span>
          <Badge className="ml-auto" variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          {(r.status === "PENDING" || r.status === "APPROVED") && (
            <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>취소</Button>
          )}
        </li>
      ))}
    </ul>
  );
}
```

### 5. page.tsx
`src/app/(app)/leave/page.tsx`:

```tsx
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { LeaveSummary } from "./leave-summary";
import { LeaveRequestForm } from "./leave-request-form";
import { MyRequests } from "./my-requests";

export default async function LeavePage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const canView = new Set(keys).has("leave.request:view");

  return (
    <section className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">연차</h1>
      {!canView ? (
        <p className="text-sm text-muted-foreground">연차 열람 권한이 없습니다.</p>
      ) : (
        <>
          <LeaveSummary />
          <LeaveRequestForm />
          <div className="space-y-2">
            <h2 className="font-medium">내 신청 내역</h2>
            <MyRequests />
          </div>
        </>
      )}
    </section>
  );
}
```

### 6. 검증·커밋
```
npm run lint && npm run typecheck && npm run build
git add "src/app/(app)/leave"
git commit -m "feat(leave): 직원 연차 UI(요약·신청·내 내역 취소)"
```

## Acceptance Criteria
- `npm run typecheck` / `npm run lint` / `npm run build` → 그린.
- (dev 환경) `/leave`에서 요약 카드·신청 폼·내 내역이 렌더, 신청/취소 시 요약·목록 갱신.

## Cautions
- **Don't 변경 후 수동 refetch하지 말 것.** Reason: `qc.invalidateQueries({ queryKey: ["leave"] })`로 요약·목록을 함께 무효화(서버가 권위).
- **Don't HALF/QUARTER에 endDate를 따로 받지 말 것.** Reason: 단일일 — `endDate=startDate`로 제출(서버 `validateLeaveTypeDates`도 검증).
- **Don't 없는 ui 프리미티브(Dialog/Select)를 import하지 말 것.** Reason: 존재하는 건 badge/button/card/input/label/separator/textarea뿐 — select는 네이티브.
