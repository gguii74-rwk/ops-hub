"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SCOPE_OPTIONS } from "../../_components/labels";
import type { OverrideRow } from "@/modules/admin/users/repositories";

const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";

// 권한키 분해 → resource/action + 빈값 null 정규화
export interface OverrideFormState {
  permissionKey: string; effect: "ALLOW" | "DENY"; scope: string;
  reason: string; startsAt: string; endsAt: string;
}

export function toOverridePayload(s: OverrideFormState) {
  const [resource, action] = s.permissionKey.split(":");
  return {
    resource: resource ?? "", action: action ?? "",
    effect: s.effect, scope: s.scope,
    reason: s.reason || null,
    startsAt: s.startsAt ? `${s.startsAt}T00:00:00.000Z` : null,
    endsAt: s.endsAt ? `${s.endsAt}T23:59:59.999Z` : null,
  };
}

const RESOURCES = [
  "dashboard",
  "calendar.work", "calendar.leave", "calendar.personal", "calendar.team", "calendar.admin",
  "workflows.weekly", "workflows.billing", "workflows.notification",
  "leave.request", "leave.approval", "leave.allocation", "leave.status", "leave.admin",
  "admin.users", "admin.settings", "admin.audit",
  "integrations.google", "integrations.smtp", "integrations.templates",
];
const ACTIONS = ["view", "create", "update", "delete", "approve", "cancel", "generate", "review", "send", "configure", "export", "impersonate"];

const PERMISSION_KEYS = RESOURCES.flatMap((r) => ACTIONS.map((a) => `${r}:${a}`));

export function OverridePanel({ userId, overrides, onMutated }: { userId: string; overrides: OverrideRow[]; onMutated: () => void }) {
  const [permissionKey, setPermissionKey] = useState(PERMISSION_KEYS[0] ?? "");
  const [effect, setEffect] = useState<"ALLOW" | "DENY">("ALLOW");
  const [scope, setScope] = useState("all");
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const add = useMutation({
    mutationFn: async () => {
      const body = toOverridePayload({ permissionKey, effect, scope, reason, startsAt, endsAt });
      const res = await fetch(`/api/admin/users/${userId}/overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `추가 실패 (${res.status})`);
    },
    onSuccess: () => { setReason(""); setStartsAt(""); setEndsAt(""); onMutated(); },
  });

  const remove = useMutation({
    mutationFn: async (overrideId: string) => {
      const res = await fetch(`/api/admin/users/${userId}/overrides?overrideId=${encodeURIComponent(overrideId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `삭제 실패 (${res.status})`);
    },
    onSuccess: () => onMutated(),
  });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">개인 권한 예외</h3>

      {overrides.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="p-2">권한</th>
                <th className="p-2">effect</th>
                <th className="p-2">scope</th>
                <th className="p-2">사유</th>
                <th className="p-2">기간</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={o.id} className="border-t border-border">
                  <td className="p-2 font-mono text-xs">{o.resource}:{o.action}</td>
                  <td className="p-2">{o.effect}</td>
                  <td className="p-2">{o.scope}</td>
                  <td className="p-2 text-muted-foreground">{o.reason ?? "-"}</td>
                  <td className="p-2 text-muted-foreground text-xs">
                    {o.startsAt ? new Date(o.startsAt).toLocaleDateString("ko-KR") : "—"}
                    {" ~ "}
                    {o.endsAt ? new Date(o.endsAt).toLocaleDateString("ko-KR") : "무기한"}
                  </td>
                  <td className="p-2 text-right">
                    <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(o.id)}>삭제</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">등록된 예외가 없습니다.</p>
      )}

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">예외 추가</summary>
        <div className="mt-3 grid gap-3">
          <div className="space-y-1">
            <Label>권한 키</Label>
            <select className={selectCls} value={permissionKey} onChange={(e) => setPermissionKey(e.target.value)}>
              {PERMISSION_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>effect</Label>
              <select className={selectCls} value={effect} onChange={(e) => setEffect(e.target.value as "ALLOW" | "DENY")}>
                <option value="ALLOW">ALLOW</option>
                <option value="DENY">DENY</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>scope</Label>
              <select className={selectCls} value={scope} onChange={(e) => setScope(e.target.value)}>
                {SCOPE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>사유(선택)</Label>
            <input
              type="text"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 일시 프로젝트 참여"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>시작일(선택)</Label>
              <input type="date" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>종료일(선택)</Label>
              <input type="date" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          {add.isError ? <p className="text-sm text-destructive">{(add.error as Error).message}</p> : null}
          <div className="flex justify-end">
            <Button size="sm" disabled={add.isPending} onClick={() => add.mutate()}>{add.isPending ? "추가 중…" : "추가"}</Button>
          </div>
        </div>
      </details>
    </div>
  );
}
