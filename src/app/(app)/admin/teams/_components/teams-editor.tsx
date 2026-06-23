"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TeamDto { id: string; name: string; leadUserId: string | null; active: boolean; memberCount: number; updatedAt: string; }
interface UserDto { id: string; name: string; teamId: string | null; }

export function TeamsEditor({ teams, users, canConfigure }: { teams: TeamDto[]; users: UserDto[]; canConfigure: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function send(url: string, method: string, body: unknown) {
    setErr(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? "오류"); return; }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">팀 관리</h1>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {canConfigure && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { send("/api/admin/teams", "POST", { name }); setName(""); } }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="새 팀 이름" />
          <Button type="submit">추가</Button>
        </form>
      )}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground"><th className="p-2">이름</th><th className="p-2">인원</th><th className="p-2">팀장</th><th className="p-2">상태</th></tr></thead>
        <tbody>
          {teams.map((t) => {
            const candidates = users.filter((u) => u.teamId === t.id);
            return (
              <tr key={t.id} className="border-t">
                <td className="p-2">
                  {canConfigure
                    ? <Input defaultValue={t.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== t.name) send(`/api/admin/teams/${t.id}`, "PATCH", { name: e.target.value, updatedAt: t.updatedAt }); }} />
                    : t.name}
                </td>
                <td className="p-2 text-muted-foreground">{t.memberCount}</td>
                <td className="p-2">
                  {canConfigure
                    ? <select className="border rounded px-2 py-1" defaultValue={t.leadUserId ?? ""} onChange={(e) => send(`/api/admin/teams/${t.id}`, "PATCH", { leadUserId: e.target.value || null, updatedAt: t.updatedAt })}>
                        <option value="">(없음)</option>
                        {candidates.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    : (users.find((u) => u.id === t.leadUserId)?.name ?? "-")}
                </td>
                <td className="p-2">
                  {canConfigure
                    ? <Button onClick={() => send(`/api/admin/teams/${t.id}`, "PATCH", { active: !t.active, updatedAt: t.updatedAt })}>{t.active ? "활성" : "비활성"}</Button>
                    : (t.active ? "활성" : "비활성")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
