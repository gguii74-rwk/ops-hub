"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QUARTER_TIME_SLOTS } from "@/modules/leave/labels";
import { Select } from "@/components/ui/select";

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

  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-medium">연차 신청</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="lt">유형</Label>
          <Select id="lt" value={state.leaveType} onChange={(e) => set("leaveType", e.target.value as LeaveType)}>
            <option value="ANNUAL">연차</option>
            <option value="HALF">반차(0.5)</option>
            <option value="QUARTER">반반차(0.25)</option>
          </Select>
        </div>
        {state.leaveType === "HALF" && (
          <div className="space-y-1">
            <Label htmlFor="st">반차 시간대</Label>
            <Select id="st" value={state.leaveSubType} onChange={(e) => set("leaveSubType", e.target.value as "MORNING" | "AFTERNOON")}>
              <option value="MORNING">오전 반차</option>
              <option value="AFTERNOON">오후 반차</option>
            </Select>
          </div>
        )}
        {state.leaveType === "QUARTER" && (
          <div className="space-y-1">
            <Label htmlFor="qt">시간대</Label>
            <Select id="qt" value={state.quarterStartTime} onChange={(e) => set("quarterStartTime", e.target.value)}>
              {QUARTER_TIME_SLOTS.map((s) => <option key={s.start} value={s.start}>{s.label}</option>)}
            </Select>
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
