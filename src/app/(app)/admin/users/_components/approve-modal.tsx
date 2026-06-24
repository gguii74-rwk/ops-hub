"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { UserAttrFields, type AttrState } from "./user-fields";
import { SYSTEM_ROLE_LABEL, SYSTEM_ROLE_OPTIONS } from "./labels";
import type { EmploymentType, JobFunction, SystemRole } from "@/lib/auth/types";

// NF2: name·teamId는 admin 확정값(승인이 프로필 권위 — 선점 덮어쓰기).
// updatedAt: 클라가 본 행 버전 — approve mutation body로 보내 stale-tab lost-update를 차단(409).
interface Target { id: string; name: string; email: string; teamId: string | null; teamName: string | null; employmentType: EmploymentType; jobFunction: JobFunction; systemRole: string; roleKeys: string[]; updatedAt: string; }

export function ApproveModal({ target, teams, onClose, onDone }: { target: Target; teams: Array<{ id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(target.name);
  const [teamId, setTeamId] = useState(target.teamId ?? "");
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
          name, teamId: teamId || null, updatedAt: target.updatedAt,
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
              <Label htmlFor="ap-team">팀 (admin 확정)</Label>
              <Select id="ap-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">무소속</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
          </div>
          <UserAttrFields state={attr} set={set} />
          <div className="space-y-1">
            <Label>systemRole</Label>
            <Select value={systemRole} onChange={(e) => setSystemRole(e.target.value as SystemRole)}>
              {SYSTEM_ROLE_OPTIONS.map((v) => <option key={v} value={v}>{SYSTEM_ROLE_LABEL[v]}</option>)}
            </Select>
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
