# Task 12 — 신청 폼 보정(반반차 6종·?date prefill)

**목적:** 기존 `leave-request-form.tsx`의 반반차 입력을 `type=time` 자유 입력에서 **6종 시간대 select**로 바꾸고, 캘린더 날짜 클릭(`?date=YYYY-MM-DD`) prefill을 지원한다. 신청 탭(`/leave/request`)에 잔여 요약 + 폼을 배치한다.

## Files
- Modify: `src/app/(app)/leave/leave-request-form.tsx`
- Modify: `src/app/(app)/leave/request/page.tsx` (Task 04 stub → 폼)

## Prep
- 엔트리포인트 §SC-5(QUARTER_TIME_SLOTS), §SC-6(신청=`leave.request:create`).
- 기존 폼: `src/app/(app)/leave/leave-request-form.tsx`(QUARTER가 `<Input type="time">`).
- 재사용: `LeaveSummary`(`../leave-summary`), `QUARTER_TIME_SLOTS`(`@/modules/leave/labels`).
- prefill은 page(서버)의 `searchParams`로 받아 prop 전달 → `useSearchParams` Suspense 회피.

## Deps
Task 02(labels). (Task 08이 `/leave` page를 대시보드로 바꿔 폼이 신청 탭으로 분리됨 — 그 후 적용 권장.)

## Steps

### 1. 신청 폼 보정
`src/app/(app)/leave/leave-request-form.tsx` 교체:
```tsx
"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QUARTER_TIME_SLOTS } from "@/modules/leave/labels";

type LeaveType = "ANNUAL" | "HALF" | "QUARTER";
interface FormState { leaveType: LeaveType; leaveSubType: "MORNING" | "AFTERNOON"; quarterStartTime: string; startDate: string; endDate: string; reason: string; }
const initial = (date?: string): FormState => ({ leaveType: "ANNUAL", leaveSubType: "MORNING", quarterStartTime: "09:00", startDate: date ?? "", endDate: "", reason: "" });

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

export function LeaveRequestForm({ defaultDate }: { defaultDate?: string }) {
  const [state, setState] = useState<FormState>(initial(defaultDate));
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => submit(state),
    onSuccess: () => { setState(initial()); qc.invalidateQueries({ queryKey: ["leave"] }); },
  });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setState((s) => ({ ...s, [k]: v }));
  const single = state.leaveType !== "ANNUAL";
  const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";

  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-medium">연차 신청</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="lt">유형</Label>
          <select id="lt" className={selectCls} value={state.leaveType} onChange={(e) => set("leaveType", e.target.value as LeaveType)}>
            <option value="ANNUAL">연차</option>
            <option value="HALF">반차(0.5)</option>
            <option value="QUARTER">반반차(0.25)</option>
          </select>
        </div>
        {state.leaveType === "HALF" && (
          <div className="space-y-1">
            <Label htmlFor="st">반차 시간대</Label>
            <select id="st" className={selectCls} value={state.leaveSubType} onChange={(e) => set("leaveSubType", e.target.value as "MORNING" | "AFTERNOON")}>
              <option value="MORNING">오전 반차</option>
              <option value="AFTERNOON">오후 반차</option>
            </select>
          </div>
        )}
        {state.leaveType === "QUARTER" && (
          <div className="space-y-1">
            <Label htmlFor="qt">시간대</Label>
            <select id="qt" className={selectCls} value={state.quarterStartTime} onChange={(e) => set("quarterStartTime", e.target.value)}>
              {QUARTER_TIME_SLOTS.map((s) => <option key={s.start} value={s.start}>{s.label}</option>)}
            </select>
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
        <Textarea id="rs" value={state.reason} onChange={(e) => set("reason", e.target.value)} rows={2} maxLength={500} />
      </div>
      {m.isError && <p className="text-sm text-destructive">{(m.error as Error).message}</p>}
      <Button disabled={m.isPending || !state.startDate || (!single && !state.endDate)} onClick={() => m.mutate()}>
        {m.isPending ? "신청 중…" : "신청"}
      </Button>
    </Card>
  );
}
```

### 2. 신청 탭 page
`src/app/(app)/leave/request/page.tsx` 교체:
```tsx
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { LeaveSummary } from "../leave-summary";
import { LeaveRequestForm } from "../leave-request-form";

export default async function LeaveRequestPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  if (!new Set(keys).has("leave.request:create")) return <p className="text-sm text-muted-foreground">연차 신청 권한이 없습니다.</p>;
  const { date } = await searchParams;
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  return (
    <div className="space-y-6">
      <LeaveSummary />
      <LeaveRequestForm defaultDate={validDate} />
    </div>
  );
}
```

## Acceptance Criteria
- `npm run build` / `npm run typecheck` / `npm run lint` / `npm test` → 통과.
- 코드 점검: QUARTER 선택 시 6종 라벨 select(자유 time 입력 없음), `/leave/request?date=2026-07-01` 진입 시 시작일 prefill.

## Cautions
- **Don't** 반반차를 `<input type="time">`으로 두지 마라 — 서버 zod가 6종 화이트리스트라 임의 시각은 400이 된다(UX 불일치).
- **Don't** `useSearchParams`를 폼에서 직접 쓰지 마라 — page(서버)의 `searchParams`로 받아 prop 전달(Suspense 경계 불필요).
- **Don't** `defaultDate`를 검증 없이 신뢰하지 마라 — page에서 `YYYY-MM-DD` 형식만 통과시킨다.
