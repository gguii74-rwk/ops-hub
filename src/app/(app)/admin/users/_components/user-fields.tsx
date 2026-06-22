"use client";
import { Label } from "@/components/ui/label";
import type { EmploymentType, JobFunction } from "@/lib/auth/types";
import { EMPLOYMENT_LABEL, EMPLOYMENT_OPTIONS, JOB_LABEL, JOB_OPTIONS, ROLE_OPTIONS } from "./labels";

const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";

export interface AttrState {
  employmentType: EmploymentType;
  jobFunction: JobFunction;
  roleKeys: string[];
}

export const emptyAttrState: AttrState = {
  employmentType: "REGULAR",
  jobFunction: "DEVELOPER",
  roleKeys: [],
};

export function UserAttrFields({
  state,
  set,
}: {
  state: AttrState;
  set: <K extends keyof AttrState>(k: K, v: AttrState[K]) => void;
}) {
  const toggleRole = (key: string) =>
    set("roleKeys", state.roleKeys.includes(key) ? state.roleKeys.filter((k) => k !== key) : [...state.roleKeys, key]);
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>고용형태</Label>
          <select className={selectCls} value={state.employmentType} onChange={(e) => set("employmentType", e.target.value as EmploymentType)}>
            {EMPLOYMENT_OPTIONS.map((v) => <option key={v} value={v}>{EMPLOYMENT_LABEL[v]}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label>직무</Label>
          <select className={selectCls} value={state.jobFunction} onChange={(e) => set("jobFunction", e.target.value as JobFunction)}>
            {JOB_OPTIONS.map((v) => <option key={v} value={v}>{JOB_LABEL[v]}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label>역할</Label>
        <div className="grid gap-1.5">
          {ROLE_OPTIONS.map((r) => (
            <label key={r.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={state.roleKeys.includes(r.key)} onChange={() => toggleRole(r.key)} />
              {r.label}
              {r.privileged ? <span className="text-xs text-muted-foreground">(OWNER만 부여)</span> : null}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
