"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/app/(app)/leave/_components/modal";
import { UserAttrFields, type AttrState } from "./user-fields";
import { SYSTEM_ROLE_LABEL, SYSTEM_ROLE_OPTIONS } from "./labels";
import type { EmploymentType, JobFunction, SystemRole } from "@/lib/auth/types";

// NF2: name·department는 admin 확정값(승인이 프로필 권위 — 선점 덮어쓰기).
interface Target { id: string; name: string; email: string; department: string | null; employmentType: EmploymentType; jobFunction: JobFunction; systemRole: string; roleKeys: string[]; }

const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";

export function ApproveModal({ target, onClose, onDone }: { target: Target; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(target.name);
  const [department, setDepartment] = useState(target.department ?? "");
  const [attr, setAttr] = useState<AttrState>({ employmentType: target.employmentType, jobFunction: target.jobFunction, roleKeys: target.roleKeys });
  const [systemRole, setSystemRole] = useState<SystemRole>(target.systemRole as SystemRole);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const set = <K extends keyof AttrState>(k: K, v: AttrState[K]) => setAttr((s) => ({ ...s, [k]: v }));

  const approve = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/users/${target.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employmentType: attr.employmentType, jobFunction: attr.jobFunction, systemRole, roleKeys: attr.roleKeys,
          name, department: department || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `승인 실패 (${res.status})`);
    },
    onSuccess: onDone,
  });
  const reject = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/users/${target.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `거절 실패 (${res.status})`);
    },
    onSuccess: onDone,
  });
  const err = (approve.error ?? reject.error) as Error | undefined;

  return (
    <Modal title={`신청 처리 — ${target.name}`} onClose={onClose}>
      <p className="text-sm text-muted-foreground">{target.email}</p>
      {rejecting ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>거절 사유</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {err ? <p className="text-sm text-destructive">{err.message}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(false)}>뒤로</Button>
            <Button variant="destructive" disabled={reject.isPending} onClick={() => reject.mutate()}>{reject.isPending ? "거절 중…" : "거절"}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ap-name">이름 (admin 확정)</Label>
              <Input id="ap-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ap-dept">부서 (admin 확정)</Label>
              <Input id="ap-dept" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="없음" />
            </div>
          </div>
          <UserAttrFields state={attr} set={set} />
          <div className="space-y-1">
            <Label>systemRole</Label>
            <select className={selectCls} value={systemRole} onChange={(e) => setSystemRole(e.target.value as SystemRole)}>
              {SYSTEM_ROLE_OPTIONS.map((v) => <option key={v} value={v}>{SYSTEM_ROLE_LABEL[v]}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">OWNER·ADMIN 부여는 OWNER만 가능합니다(서버 검증).</p>
          </div>
          {err ? <p className="text-sm text-destructive">{err.message}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(true)}>거절</Button>
            <Button disabled={approve.isPending} onClick={() => approve.mutate()}>{approve.isPending ? "승인 중…" : "승인"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
