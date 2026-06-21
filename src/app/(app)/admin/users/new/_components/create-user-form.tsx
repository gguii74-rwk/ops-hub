"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { UserAttrFields, emptyAttrState, type AttrState } from "../../_components/user-fields";
import { SYSTEM_ROLE_LABEL, SYSTEM_ROLE_OPTIONS } from "../../_components/labels";
import type { SystemRole } from "@/lib/auth/types";

const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";

export interface CreateUserState {
  email: string; name: string; password: string; department: string;
  employmentType: AttrState["employmentType"]; jobFunction: AttrState["jobFunction"];
  systemRole: SystemRole; roleKeys: string[];
}

export function toCreateUserPayload(s: CreateUserState) {
  return {
    email: s.email, name: s.name, password: s.password, department: s.department || null,
    employmentType: s.employmentType, jobFunction: s.jobFunction, systemRole: s.systemRole, roleKeys: s.roleKeys,
  };
}

export function CreateUserForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [department, setDepartment] = useState("");
  const [systemRole, setSystemRole] = useState<SystemRole>("MEMBER");
  const [attr, setAttr] = useState<AttrState>(emptyAttrState);
  const set = <K extends keyof AttrState>(k: K, v: AttrState[K]) => setAttr((s) => ({ ...s, [k]: v }));

  const m = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toCreateUserPayload({
          email, name, password, department,
          employmentType: attr.employmentType, jobFunction: attr.jobFunction, systemRole, roleKeys: attr.roleKeys,
        })),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `추가 실패 (${res.status})`);
    },
    onSuccess: () => router.push("/admin/users"),
  });

  const canSubmit = email && name && password.length >= 12 && !m.isPending;
  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="email">이메일</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="name">이름</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="temp">임시 비밀번호 (12자 이상)</Label>
          <Input id="temp" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={password.length > 0 && password.length < 12} />
          <p className="text-xs text-muted-foreground">추가 후 사용자는 최초 로그인 시 비밀번호를 변경해야 합니다.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="dept">부서(선택)</Label>
          <Input id="dept" value={department} onChange={(e) => setDepartment(e.target.value)} />
        </div>
        <UserAttrFields state={attr} set={set} />
        <div className="space-y-1">
          <Label>systemRole</Label>
          <select className={selectCls} value={systemRole} onChange={(e) => setSystemRole(e.target.value as SystemRole)}>
            {SYSTEM_ROLE_OPTIONS.map((v) => <option key={v} value={v}>{SYSTEM_ROLE_LABEL[v]}</option>)}
          </select>
        </div>
        {m.isError ? <p className="text-sm text-destructive">{(m.error as Error).message}</p> : null}
        <div className="flex justify-end">
          <Button disabled={!canSubmit} onClick={() => m.mutate()}>{m.isPending ? "추가 중…" : "추가"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
