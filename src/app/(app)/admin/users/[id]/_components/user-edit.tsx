"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { UserAttrFields, type AttrState } from "../../_components/user-fields";
import { SYSTEM_ROLE_LABEL, SYSTEM_ROLE_OPTIONS, STATUS_LABEL, STATUS_VARIANT, type UserStatusKey } from "../../_components/labels";
import { OverridePanel } from "./override-panel";
import type { SystemRole } from "@/lib/auth/types";

interface UserDetail {
  id: string; email: string; name: string; status: string;
  employmentType: string; jobFunction: string; systemRole: string;
  teamId: string | null; teamName: string | null; mustChangePassword: boolean;
  roleKeys: string[];
  updatedAt: string; // 낙관락(mutation body로 전달 — stale-tab lost-update 차단)
  overrides: Array<{ id: string; resource: string; action: string; effect: string; scope: string; reason: string | null; startsAt: Date | null; endsAt: Date | null }>;
}

async function fetchUser(id: string): Promise<UserDetail> {
  const res = await fetch(`/api/admin/users/${id}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`user ${res.status}`);
  return res.json();
}

export function UserEdit({ userId, canUpdate, teams }: { userId: string; canUpdate: boolean; teams: Array<{ id: string; name: string }> }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-user", userId],
    queryFn: () => fetchUser(userId),
  });

  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [systemRole, setSystemRole] = useState<SystemRole>("MEMBER");
  const [attr, setAttr] = useState<AttrState>({ employmentType: "REGULAR", jobFunction: "DEVELOPER", roleKeys: [] });
  const [initialized, setInitialized] = useState(false);
  const set = <K extends keyof AttrState>(k: K, v: AttrState[K]) => setAttr((s) => ({ ...s, [k]: v }));

  // 데이터 로드 후 초기화(1회)
  if (data && !initialized) {
    setName(data.name);
    setTeamId(data.teamId ?? null);
    setSystemRole(data.systemRole as SystemRole);
    setAttr({ employmentType: data.employmentType as AttrState["employmentType"], jobFunction: data.jobFunction as AttrState["jobFunction"], roleKeys: data.roleKeys });
    setInitialized(true);
  }

  const refetch = () => { void qc.invalidateQueries({ queryKey: ["admin-user", userId] }); };
  // 409(Conflict): 모달을 열어둔 사이 다른 세션이 행을 바꿈. 최신값을 다시 로드하고 폼을 재초기화(initialized 가드 해제)해
  // 사용자가 서버 최신 상태를 보고 의식적으로 다시 적용하게 한다. 에러 메시지는 기존대로 표시(onError 후에도 mutation.error 유지).
  const reloadOnConflict = (res: Response) => {
    if (res.status === 409) { setInitialized(false); refetch(); }
  };

  const update = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // systemRole이 원래 값과 같으면 PATCH에서 생략한다 — OPTIONS·zod에서 폐지된 값(예: 기존 MANAGER 사용자)도
        // 무변경 편집(이름·팀·속성)이 가능. 신규 부여 차단은 드롭다운(SYSTEM_ROLE_OPTIONS)·zod(systemRole 3값)가 담당.
        body: JSON.stringify({
          name, teamId: teamId || null, employmentType: attr.employmentType, jobFunction: attr.jobFunction,
          ...(systemRole !== data?.systemRole ? { systemRole } : {}),
          updatedAt: data?.updatedAt,
        }),
      });
      if (!res.ok) { reloadOnConflict(res); throw new Error((await res.json().catch(() => ({}))).error ?? `수정 실패 (${res.status})`); }
    },
    onSuccess: refetch,
  });

  const setRoles = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleKeys: attr.roleKeys, updatedAt: data?.updatedAt }),
      });
      if (!res.ok) { reloadOnConflict(res); throw new Error((await res.json().catch(() => ({}))).error ?? `역할 저장 실패 (${res.status})`); }
    },
    onSuccess: refetch,
  });

  const setStatus = useMutation({
    mutationFn: async (status: "ACTIVE" | "DISABLED") => {
      const res = await fetch(`/api/admin/users/${userId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, updatedAt: data?.updatedAt }),
      });
      if (!res.ok) { reloadOnConflict(res); throw new Error((await res.json().catch(() => ({}))).error ?? `상태 변경 실패 (${res.status})`); }
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

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState />;

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
                  <Label htmlFor="edit-team">팀</Label>
                  <Select id="edit-team" value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value || null)}>
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
              <div><span className="text-muted-foreground">팀: </span>{data.teamName ?? "-"}</div>
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
