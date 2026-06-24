"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QUARTER_TIME_SLOTS } from "@/modules/leave/labels";
import { Select } from "@/components/ui/select";

export interface LeaveFormState {
  leaveType: "ANNUAL" | "HALF" | "QUARTER";
  leaveSubType: "MORNING" | "AFTERNOON";
  quarterStartTime: string;
  startDate: string;
  endDate: string;
  reason: string;
}

export const emptyLeaveForm: LeaveFormState = {
  leaveType: "ANNUAL",
  leaveSubType: "MORNING",
  quarterStartTime: "09:00",
  startDate: "",
  endDate: "",
  reason: "",
};

export function LeaveFields({
  state,
  set,
}: {
  state: LeaveFormState;
  set: <K extends keyof LeaveFormState>(k: K, v: LeaveFormState[K]) => void;
}) {
  const single = state.leaveType !== "ANNUAL";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label>유형</Label>
        <Select value={state.leaveType} onChange={(e) => set("leaveType", e.target.value as LeaveFormState["leaveType"])}>
          <option value="ANNUAL">연차</option>
          <option value="HALF">반차(0.5)</option>
          <option value="QUARTER">반반차(0.25)</option>
        </Select>
      </div>
      {state.leaveType === "HALF" && (
        <div className="space-y-1">
          <Label>반차 시간대</Label>
          <Select value={state.leaveSubType} onChange={(e) => set("leaveSubType", e.target.value as "MORNING" | "AFTERNOON")}>
            <option value="MORNING">오전 반차</option>
            <option value="AFTERNOON">오후 반차</option>
          </Select>
        </div>
      )}
      {state.leaveType === "QUARTER" && (
        <div className="space-y-1">
          <Label>시간대</Label>
          <Select value={state.quarterStartTime} onChange={(e) => set("quarterStartTime", e.target.value)}>
            {QUARTER_TIME_SLOTS.map((s) => <option key={s.start} value={s.start}>{s.label}</option>)}
          </Select>
        </div>
      )}
      <div className="space-y-1">
        <Label>{single ? "날짜" : "시작일"}</Label>
        <Input
          type="date"
          value={state.startDate}
          onChange={(e) => set("startDate", e.target.value)}
        />
      </div>
      {!single && (
        <div className="space-y-1">
          <Label>종료일</Label>
          <Input
            type="date"
            value={state.endDate}
            onChange={(e) => set("endDate", e.target.value)}
          />
        </div>
      )}
      <div className="space-y-1 sm:col-span-2">
        <Label>사유(선택)</Label>
        <Textarea
          rows={2}
          value={state.reason}
          onChange={(e) => set("reason", e.target.value)}
        />
      </div>
    </div>
  );
}

// 폼 상태 → API 페이로드(single이면 endDate=startDate, 유형별 sub 필드 정리).
export function toLeavePayload(s: LeaveFormState) {
  const single = s.leaveType !== "ANNUAL";
  return {
    leaveType: s.leaveType,
    leaveSubType: s.leaveType === "HALF" ? s.leaveSubType : undefined,
    quarterStartTime: s.leaveType === "QUARTER" ? s.quarterStartTime : undefined,
    startDate: s.startDate,
    endDate: single ? s.startDate : s.endDate,
    reason: s.reason || undefined,
  };
}
