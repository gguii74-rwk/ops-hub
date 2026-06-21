"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAttrFields, type AttrState } from "../../_components/user-fields";
import { SYSTEM_ROLE_LABEL, SYSTEM_ROLE_OPTIONS, STATUS_LABEL, STATUS_VARIANT, type UserStatusKey } from "../../_components/labels";
import { OverridePanel } from "./override-panel";
import type { SystemRole } from "@/lib/auth/types";

const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";

interface UserDetail {
  id: string; email: string; name: string; status: string;
  employmentType: string; jobFunction: string; systemRole: string;
  department: string | null; mustChangePassword: boolean;
  roleKeys: string[];
  overrides: Array<{ id: string; resource: string; action: string; effect: string; scope: string; reason: string | null; startsAt: Date | null; endsAt: Date | null }>;
}

async function fetchUser(id: string): Promise<UserDetail> {
  const res = await fetch(`/api/admin/users/${id}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`user ${res.status}`);
  return res.json();
}

export function UserEdit({ userId, canUpdate }: { userId: string; canUpdate: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-user", userId],
    queryFn: () => fetchUser(userId),
  });

  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [systemRole, setSystemRole] = useState<SystemRole>("MEMBER");
  const [attr, setAttr] = useState<AttrState>({ employmentType: "REGULAR", jobFunction: "DEVELOPER", roleKeys: [] });
  const [initialized, setInitialized] = useState(false);
  const set = <K extends keyof AttrState>(k: K, v: AttrState[K]) => setAttr((s) => ({ ...s, [k]: v }));

  // 데이터 로드 후 초기화(1회)
  if (data && !initialized) {
    setName(data.name);
    setDepartment(data.department ?? "");
    setSystemRole(data.systemRole as SystemRole);
    setAttr({ employmentType: data.employmentType as AttrState["employmentType"], jobFunction: data.jobFunction as AttrState["jobFunction"], roleKeys: data.roleKeys });
    setInitialized(true);
  }

  const refetch = () => { void qc.invalidateQueries({ queryKey: ["admin-user", userId] }); };

  const update = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, department: department || null, employmentType: attr.employmentType, jobFunction: attr.jobFunction, systemRole }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `수정 실패 (${res.status})`);
    },
    onSuccess: refetch,
  });

  const setRoles = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleKeys: attr.roleKeys }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `역할 저장 실패 (${res.status})`);
    },
    onSuccess: refetch,
  });

  const setStatus = useMutation({
    mutationFn: async (status: "ACTIVE" | "DISABLED") => {
      const res = await fetch(`/api/admin/users/${userId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `상태 변경 실패 (${res.status})`);
    },
    onSuccess: refetch,
  });

  const resetPw = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `재설정 실패 (${res.status})`);
      return res.json() as Promise<{ temporaryPassword: string }>;
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  if (isError || !data) return <p className="text-sm text-destructive">불러오지 못했습니다.</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3">
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[data.status as UserStatusKey]}>{STATUS_LABEL[data.status as UserStatusKey] ?? data.status}</Badge>
            <span className="text-sm text-muted-foreground">{data.email}</span>
            {data.mustChangePassword ? <Badge variant="secondary">비번변경 필요</Badge> : null}
          </div>

          {canUpdate ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="edit-name">이름</Label>
                  <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-dept">부서</Label>
                  <Input id="edit-dept" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="없음" />
                </div>
              </div>
              <UserAttrFields state={attr} set={set} />
              <div className="space-y-1">
                <Label>systemRole</Label>
                <select className={selectCls} value={systemRole} onChange={(e) => setSystemRole(e.target.value as SystemRole)}>
                  {SYSTEM_ROLE_OPTIONS.map((v) => <option key={v} value={v}>{SYSTEM_ROLE_LABEL[v]}</option>)}
                </select>
              </div>
              {update.isError ? <p className="text-sm text-destructive">{(update.error as Error).message}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={update.isPending} onClick={() => update.mutate()}>{update.isPending ? "저장 중…" : "속성 저장"}</Button>
                <Button size="sm" variant="outline" disabled={setRoles.isPending} onClick={() => setRoles.mutate()}>{setRoles.isPending ? "저장 중…" : "역할 저장"}</Button>
              </div>
            </>
          ) : (
            <div className="space-y-1 text-sm">
              <div><span className="text-muted-foreground">이름: </span>{data.name}</div>
              <div><span className="text-muted-foreground">부서: </span>{data.department ?? "-"}</div>
              <div><span className="text-muted-foreground">고용형태: </span>{data.employmentType}</div>
              <div><span className="text-muted-foreground">직무: </span>{data.jobFunction}</div>
              <div><span className="text-muted-foreground">systemRole: </span>{data.systemRole}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {canUpdate ? (
        <Card>
          <CardContent className="grid gap-3">
            <h3 className="text-sm font-medium">상태 · 비밀번호</h3>
            <div className="flex flex-wrap gap-2">
              {data.status === "ACTIVE" ? (
                <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate("DISABLED")}>비활성화</Button>
              ) : data.status === "DISABLED" ? (
                <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate("ACTIVE")}>활성화</Button>
              ) : null}
              <Button size="sm" variant="outline" disabled={resetPw.isPending} onClick={() => resetPw.mutate()}>
                {resetPw.isPending ? "재설정 중…" : "비밀번호 재설정"}
              </Button>
            </div>
            {resetPw.isSuccess && resetPw.data ? (
              <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
                <p className="font-medium">임시 비밀번호 (1회만 표시)</p>
                <code className="font-mono text-base">{resetPw.data.temporaryPassword}</code>
                <p className="mt-1 text-xs text-muted-foreground">사용자에게 안전한 채널로 전달하세요.</p>
              </div>
            ) : null}
            {setStatus.isError ? <p className="text-sm text-destructive">{(setStatus.error as Error).message}</p> : null}
            {resetPw.isError ? <p className="text-sm text-destructive">{(resetPw.error as Error).message}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {canUpdate ? (
        <Card>
          <CardContent>
            <OverridePanel userId={userId} overrides={data.overrides} onMutated={refetch} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
