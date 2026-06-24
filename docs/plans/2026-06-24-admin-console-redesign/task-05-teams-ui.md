# Task 05 — 팀 관리 화면 재디자인 (Aurora)

`teams-editor.tsx`를 Aurora로 재조립한다: PageHeader(eyebrow "조직") → StatStrip(전체 팀/총 인원/팀장 지정, **teams 배열에서 파생 — 백엔드 변경 없음**) → Card{팀 추가 폼 + Table}. native `<select>`/raw `<table>`/자체 `<h1>`을 프리미티브로 교체, 활성 토글은 `Switch`로. `send()`·`updatedAt` 낙관락은 그대로.

## Files

- Modify `src/app/(app)/admin/teams/_components/teams-editor.tsx`
- Create `tests/app/admin/teams/team-stats.test.ts`

## Prep

- entrypoint §Shared Contracts(프리미티브).
- 현재 `teams-editor.tsx`(전문): `send(url,method,body)`(router.refresh), 이름 inline Input onBlur PATCH, 팀장 native select, 상태 Button 토글 — 모두 `updatedAt`(낙관락) 동반. `teams/page.tsx`가 `updatedAt`을 ISO string으로 내려줌.
- 팀장 후보 = `users.filter(u => u.teamId === t.id)`(현 로직 유지).

## Deps

01, 02. (02는 직접 import 안 하나 Chip 톤 "ok"/"off"만 사용 — Chip은 01.)

## Cautions

- **`send()`·낙관락·팀장 후보 필터 로직 불변.** 모든 PATCH는 `{ ..., updatedAt: t.updatedAt }`를 유지한다. Reason: 동시 수정 lost-update 차단(서버 CAS 키).
- **Switch 토글은 `next`(불린)를 그대로 보낸다** — 현 `!t.active`와 동치. `onCheckedChange={(next) => send(... { active: next, updatedAt })}`. Reason: Switch가 이미 negate한 값을 준다.
- StatStrip은 **클라이언트 파생**(props teams) — 새 API 호출 금지. Reason: 데이터가 이미 내려옴, 추가 요청은 낭비.

## TDD steps

### 1. teamStats 실패 테스트

`tests/app/admin/teams/team-stats.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { teamStats } from "@/app/(app)/admin/teams/_components/teams-editor";

const T = (over: Partial<{ id: string; name: string; leadUserId: string | null; active: boolean; memberCount: number; updatedAt: string }>) =>
  ({ id: "t", name: "n", leadUserId: null, active: true, memberCount: 0, updatedAt: "2026-01-01T00:00:00.000Z", ...over });

describe("teamStats", () => {
  it("counts teams, sums members, counts assigned leads", () => {
    const s = teamStats([
      T({ id: "a", memberCount: 8, leadUserId: "u1" }),
      T({ id: "b", memberCount: 3, leadUserId: null }),
      T({ id: "c", memberCount: 5, leadUserId: "u2" }),
    ]);
    expect(s).toEqual({ count: 3, members: 16, led: 2 });
  });
  it("handles empty list", () => {
    expect(teamStats([])).toEqual({ count: 0, members: 0, led: 0 });
  });
});
```

실행: `npm test -- team-stats` → FAIL(`teamStats` 미export).

### 2. teams-editor.tsx — 전체 교체

```tsx
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
```

실행: `npm test -- team-stats` → PASS.

### 3. 검증·커밋

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add "src/app/(app)/admin/teams/_components/teams-editor.tsx" tests/app/admin/teams/team-stats.test.ts
git commit -m "feat(admin): 팀 관리 화면 Aurora 재디자인(StatStrip·Switch·Select 프리미티브)"
```

## Acceptance Criteria

```bash
npm run typecheck   # 0 errors
npm run lint        # 0 errors
npm test            # team-stats 통과 + green
npm run build       # 성공
```

수동 확인: eyebrow "조직", 3 스탯(전체 팀/총 인원/팀장 지정), 팀명 inline 편집, 팀장 Select, 활성 Switch 토글(저장 시 router.refresh), 읽기 전용 사용자는 입력 대신 텍스트/Chip. 모든 수정이 `updatedAt` 동반(동시 수정 시 409 메시지 노출).
