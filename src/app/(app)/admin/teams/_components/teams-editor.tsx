"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Chip } from "@/components/ui/chip";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-section";
import { StatStrip, Stat } from "@/components/ui/stat-strip";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "@/components/ui/table";

interface TeamDto { id: string; name: string; leadUserId: string | null; active: boolean; memberCount: number; updatedAt: string; }
interface UserDto { id: string; name: string; teamId: string | null; }

// 요약 통계 파생(순수 — 테스트 대상). props teams에서만 계산(추가 API 없음).
export function teamStats(teams: TeamDto[]): { count: number; members: number; led: number } {
  return {
    count: teams.length,
    members: teams.reduce((s, t) => s + t.memberCount, 0),
    led: teams.filter((t) => t.leadUserId).length,
  };
}

export function TeamsEditor({ teams, users, canConfigure }: { teams: TeamDto[]; users: UserDto[]; canConfigure: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const stats = teamStats(teams);

  async function send(url: string, method: string, body: unknown) {
    setErr(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? "오류"); return; }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="조직" title="팀 관리" />
      {err && <p className="text-sm text-destructive">{err}</p>}

      <StatStrip>
        <Stat value={stats.count} label="전체 팀" />
        <Stat value={stats.members} label="총 인원" />
        <Stat value={stats.led} label="팀장 지정" />
      </StatStrip>

      <Card>
        <CardContent className="space-y-4">
          {canConfigure && (
            <form
              className="flex gap-2"
              onSubmit={(e) => { e.preventDefault(); if (name.trim()) { send("/api/admin/teams", "POST", { name }); setName(""); } }}
            >
              <Input className="max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="새 팀 이름" />
              <Button type="submit" size="sm">＋ 팀 추가</Button>
            </form>
          )}

          <Table bordered={false}>
            <TableHeader>
              <TableRow>
                <TableHead>팀</TableHead>
                <TableHead>인원</TableHead>
                <TableHead>팀장</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((t) => {
                const candidates = users.filter((u) => u.teamId === t.id);
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      {canConfigure
                        ? <Input className="max-w-[220px]" defaultValue={t.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== t.name) send(`/api/admin/teams/${t.id}`, "PATCH", { name: e.target.value, updatedAt: t.updatedAt }); }} />
                        : t.name}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{t.memberCount}</TableCell>
                    <TableCell>
                      {canConfigure
                        ? <Select className="w-auto min-w-[140px]" defaultValue={t.leadUserId ?? ""} onChange={(e) => send(`/api/admin/teams/${t.id}`, "PATCH", { leadUserId: e.target.value || null, updatedAt: t.updatedAt })}>
                            <option value="">(없음)</option>
                            {candidates.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </Select>
                        : <span className="text-muted-foreground">{users.find((u) => u.id === t.leadUserId)?.name ?? "미지정"}</span>}
                    </TableCell>
                    <TableCell>
                      {canConfigure
                        ? <span className="inline-flex items-center gap-2">
                            <Switch checked={t.active} onCheckedChange={(next) => send(`/api/admin/teams/${t.id}`, "PATCH", { active: next, updatedAt: t.updatedAt })} label="팀 활성" />
                            <span className="text-xs text-muted-foreground">{t.active ? "활성" : "비활성"}</span>
                          </span>
                        : <Chip tone={t.active ? "ok" : "off"}>{t.active ? "활성" : "비활성"}</Chip>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {teams.length === 0 ? <TableEmpty colSpan={4}>팀이 없습니다.</TableEmpty> : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
