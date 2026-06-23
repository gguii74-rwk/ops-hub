# task-03 — 팀 관리(catalog admin.teams + service/repo 불변식 + /admin/teams API·UI)

**목적:** `admin.teams` 권한·nav 부트스트랩, 팀 CRUD(생성·이름변경·active 토글·팀장 지정) + **팀장 불변식**(D1/F3: lead ∈ active 팀원). 사용자↔팀 배정은 task-04(user-edit).

## Files
- Modify: `src/kernel/access/catalog.ts` (`RESOURCES += "admin.teams"`, `NAV` admin 자식에 `admin-teams`)
- Modify: `prisma/seed-permissions.ts` (`EXTRA_PERMISSIONS += ["admin.teams","configure"]`)
- Modify: `prisma/seed-roles.ts` (위임 `admin`에 `admin.teams:view`/`admin.teams:configure`)
- Create: `src/modules/admin/teams/errors.ts` (`TeamConflictError` 409, `TeamInvariantError` 422 — 모듈별 에러 패턴, `LeaveConflictError` 선례)
- Create: `src/modules/admin/teams/validations/index.ts`
- Create: `src/modules/admin/teams/repositories/index.ts`
- Create: `src/modules/admin/teams/services/index.ts`
- Create: `src/app/api/admin/teams/route.ts` (GET 목록, POST 생성)
- Create: `src/app/api/admin/teams/[id]/route.ts` (PATCH 이름/active/lead)
- Create: `src/app/(app)/admin/teams/page.tsx` + `_components/teams-editor.tsx`
- Create: `tests/modules/admin/teams/teams-service.test.ts` (F3 lead 불변식)
- Create: `tests/kernel/access/teams-catalog.test.ts`

## Prep
- 엔트리포인트 §Shared Contracts "카탈로그·권한·nav 추가", "팀장 불변식", "감사 로그 패턴".
- 패턴: `src/modules/admin/navigation/{services,repositories}`(configure 게이트 + in-tx audit), `src/app/(app)/admin/navigation/page.tsx`(getPermissionSummary 가드).

## Deps
01 (Team 모델).

## Steps

### 1. catalog/permissions/nav 추가 (실패 테스트 먼저)

`tests/kernel/access/teams-catalog.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { RESOURCES, NAV } from "@/kernel/access/catalog";

describe("admin.teams 카탈로그·nav (D11)", () => {
  it("RESOURCES에 admin.teams 포함", () => {
    expect(RESOURCES).toContain("admin.teams");
  });
  it("NAV admin 트리에 admin-teams(/admin/teams, admin.teams:view)", () => {
    const admin = NAV.find((n) => n.key === "admin");
    const teams = admin?.children?.find((c) => c.key === "admin-teams");
    expect(teams).toMatchObject({ href: "/admin/teams", permission: "admin.teams:view" });
  });
});
```
실행 → **FAIL**.

`src/kernel/access/catalog.ts`:
- `RESOURCES` 배열의 admin 줄에 `"admin.teams"` 추가:
  ```ts
    "admin.users", "admin.settings", "admin.audit", "admin.navigation", "admin.teams",
  ```
- `NAV`의 `admin` 자식 배열에 추가(`admin-users` 다음):
  ```ts
        { key: "admin-teams", label: "팀 관리", href: "/admin/teams", permission: "admin.teams:view" },
  ```

`prisma/seed-permissions.ts` `EXTRA_PERMISSIONS`에 추가:
```ts
  ["admin.teams", "configure"],
```

`prisma/seed-roles.ts` 위임 `admin` 배열에 추가(`admin.navigation:configure` 다음):
```ts
    "admin.teams:view", "admin.teams:configure",
```
실행 → catalog 테스트 **PASS**.

### 2. validations

`src/modules/admin/teams/validations/index.ts`:
```ts
import { z } from "zod";
import { expectedUpdatedAt } from "@/kernel/optimistic";

const teamName = z.string().trim().min(1, "팀 이름은 필수입니다.").max(100);

export const createTeamSchema = z.object({ name: teamName });

// 부분 patch — 이름/active/팀장 중 보낸 것만. leadUserId=null은 "팀장 해제".
export const updateTeamSchema = z.object({
  name: teamName.optional(),
  active: z.boolean().optional(),
  leadUserId: z.string().min(1).nullish(), // null 허용(해제), undefined면 미변경
});
export const updateTeamBodySchema = updateTeamSchema.extend({ updatedAt: expectedUpdatedAt });

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
```

### 3. errors + repositories — CRUD + lead 불변식 + reconcile

`src/modules/admin/teams/errors.ts` (모듈별 에러 클래스 — `src/modules/leave/errors.ts` 선례):
```ts
export class TeamConflictError extends Error {        // 409 — stale CAS / 미존재
  constructor(message = "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.") { super(message); this.name = "TeamConflictError"; }
}
export class TeamInvariantError extends Error {        // 422 — 팀장 불변식 위반
  constructor(message: string) { super(message); this.name = "TeamInvariantError"; }
}
```

`src/modules/admin/teams/repositories/index.ts`:
```ts
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TeamConflictError, TeamInvariantError } from "../errors";

export interface TeamRow {
  id: string; name: string; leadUserId: string | null; active: boolean;
  memberCount: number; updatedAt: Date;
}

// 팀장 후보·배정 표시용. teamId는 task-01에서 User에 추가됨 → leave 모듈에 의존하지 않고 자체 조회(자기완결).
export function listActiveUsersWithTeam(): Promise<Array<{ id: string; name: string; teamId: string | null }>> {
  return prisma.user.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, teamId: true } });
}

export async function listTeams(): Promise<TeamRow[]> {
  const teams = await prisma.team.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, leadUserId: true, active: true, updatedAt: true, _count: { select: { members: true } } },
  });
  return teams.map((t) => ({
    id: t.id, name: t.name, leadUserId: t.leadUserId, active: t.active,
    memberCount: t._count.members, updatedAt: t.updatedAt,
  }));
}

export function createTeam(name: string, actorId: string): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const t = await tx.team.create({ data: { name }, select: { id: true } });
    await tx.auditLog.create({ data: { actorId, entityType: "Team", entityId: t.id, action: "team.create", metadata: { name } } });
    return t;
  });
}

// 이름/active/lead 부분 갱신. CAS(updatedAt). lead 지정 시 불변식 강제(F3). active=false면 lead 자동 해제(D1).
export async function updateTeam(
  id: string,
  patch: { name?: string; active?: boolean; leadUserId?: string | null | undefined },
  expectedUpdatedAt: Date,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.team.findUnique({ where: { id }, select: { name: true, active: true, leadUserId: true, updatedAt: true } });
    if (!before) throw new TeamConflictError("팀을 찾을 수 없습니다.");

    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.active !== undefined) data.active = patch.active;

    // 팀장 지정/해제 — 불변식: lead ∈ 이 팀의 active 소속원(F3 교차팀 누수 방지).
    if (patch.leadUserId !== undefined) {
      if (patch.leadUserId === null) {
        data.leadUserId = null;
      } else {
        const cand = await tx.user.findUnique({ where: { id: patch.leadUserId }, select: { teamId: true, status: true } });
        if (!cand || cand.teamId !== id || cand.status !== "ACTIVE") {
          throw new TeamInvariantError("팀장은 해당 팀의 활성 소속원만 지정할 수 있습니다.");
        }
        data.leadUserId = patch.leadUserId;
      }
    }
    // active=false로 바뀌면 팀장 의미 없음 → 해제(명시적 lead 지정과 충돌하지 않게 active 먼저 평가).
    if (patch.active === false && data.leadUserId === undefined) data.leadUserId = null;

    // CAS: 클라가 본 버전과 다르면 0행 → Conflict.
    const res = await tx.team.updateMany({ where: { id, updatedAt: expectedUpdatedAt }, data });
    if (res.count === 0) throw new TeamConflictError();

    await tx.auditLog.create({
      data: { actorId, entityType: "Team", entityId: id, action: "team.update",
        metadata: { before: { name: before.name, active: before.active, leadUserId: before.leadUserId }, patch } },
    });
  });
}

// 멤버십 이동·비활성화로 무효가 된 lead 정리(D1). userId가 팀장인 팀 중, 그가 더 이상 그 팀의 active 소속원이
// 아니면 leadUserId=null. user-edit(teamId 변경)·user 비활성화 경로가 호출(task-04). tx 주입형 — 같은 트랜잭션 합류.
export async function reconcileTeamLeadTx(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  // leadUserId=userId인 팀 중, 그 팀에 해당 user가 active 소속이 아닌 팀의 lead를 null로.
  await tx.team.updateMany({
    where: { leadUserId: userId, NOT: { members: { some: { id: userId, status: "ACTIVE" } } } },
    data: { leadUserId: null },
  });
}
```
(CAS는 `expectedUpdatedAt`(클라가 본 버전, `@/kernel/optimistic`). 에러는 teams 전용 클래스(위 errors.ts).)

### 4. services — configure 게이트

`src/modules/admin/teams/services/index.ts`:
```ts
import "server-only";
import { requirePermission } from "@/kernel/access";
import { listTeams, createTeam, updateTeam, type TeamRow } from "../repositories";
import type { CreateTeamInput, UpdateTeamInput } from "../validations";

const RESOURCE = "admin.teams";

export function listTeamsForAdmin(): Promise<TeamRow[]> {
  return listTeams();
}

export async function createTeamAsAdmin(actorId: string, input: CreateTeamInput): Promise<{ id: string }> {
  await requirePermission(actorId, RESOURCE, "configure");
  return createTeam(input.name, actorId);
}

export async function updateTeamAsAdmin(
  actorId: string, id: string, patch: UpdateTeamInput, expectedUpdatedAt: Date,
): Promise<void> {
  await requirePermission(actorId, RESOURCE, "configure");
  await updateTeam(id, patch, expectedUpdatedAt, actorId);
}
```

### 5. API routes

`src/app/api/admin/teams/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission, ForbiddenError } from "@/kernel/access";
import { listTeamsForAdmin, createTeamAsAdmin } from "@/modules/admin/teams/services";
import { createTeamSchema } from "@/modules/admin/teams/validations";
import { TeamConflictError, TeamInvariantError } from "@/modules/admin/teams/errors";

function mapError(e: unknown) {
  if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof TeamInvariantError) return NextResponse.json({ error: e.message }, { status: 422 });
  if (e instanceof TeamConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
  return NextResponse.json({ error: "서버 오류" }, { status: 500 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    await requirePermission(session.user.id, "admin.teams", "view");
    const teams = await listTeamsForAdmin();
    return NextResponse.json({ teams }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return mapError(e); }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = createTeamSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    const created = await createTeamAsAdmin(session.user.id, parsed.data);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (e) { return mapError(e); }
}
```

`src/app/api/admin/teams/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/kernel/access";
import { updateTeamAsAdmin } from "@/modules/admin/teams/services";
import { updateTeamBodySchema } from "@/modules/admin/teams/validations";
import { TeamConflictError, TeamInvariantError } from "@/modules/admin/teams/errors";
import { parseExpectedUpdatedAt } from "@/kernel/optimistic";

function mapError(e: unknown) {
  if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof TeamInvariantError) return NextResponse.json({ error: e.message }, { status: 422 });
  if (e instanceof TeamConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
  return NextResponse.json({ error: "서버 오류" }, { status: 500 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = updateTeamBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const { updatedAt, ...patch } = parsed.data;
  try {
    await updateTeamAsAdmin(session.user.id, id, patch, parseExpectedUpdatedAt(updatedAt));
    return NextResponse.json({ ok: true });
  } catch (e) { return mapError(e); }
}
```
(`expectedUpdatedAt`(zod)·`parseExpectedUpdatedAt`(ISO→Date)·`ConflictError`는 `@/kernel/optimistic`의 기존 export — navigation/users 라우트와 동일.)

### 6. UI — page + client editor

`src/app/(app)/admin/teams/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { listTeamsForAdmin, listActiveUsersWithTeam } from "@/modules/admin/teams/services";
import { TeamsEditor } from "./_components/teams-editor";

export default async function AdminTeamsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const summary = await getPermissionSummary(session.user.id);
  const canView = summary.isOwner || summary.keys.includes("admin.teams:view");
  if (!canView) redirect("/dashboard");
  const canConfigure = summary.isOwner || summary.keys.includes("admin.teams:configure");

  const [teams, users] = await Promise.all([listTeamsForAdmin(), listActiveUsersWithTeam()]);
  return (
    <TeamsEditor
      teams={teams.map((t) => ({ ...t, updatedAt: t.updatedAt.toISOString() }))}
      users={users}
      canConfigure={canConfigure}
    />
  );
}
```
(`listActiveUsersWithTeam`는 teams 모듈 자체 함수 — leave 모듈 비의존, 자기완결. service에서 re-export: `export { listActiveUsersWithTeam } from "../repositories";`)

`src/app/(app)/admin/teams/_components/teams-editor.tsx`:
```tsx
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
```
(`Input`은 `@/components/ui/input` 확인. `Button`은 `asChild` 미지원 — native button만, CLAUDE.md.)

### 7. F3 lead 불변식 테스트

`tests/modules/admin/teams/teams-service.test.ts` (repository updateTeam 직접 — prisma tx mock):
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const tx = {
    team: { findUnique: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return { tx, db: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) } };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { updateTeam } from "@/modules/admin/teams/repositories";
// 에러 클래스는 실제(prisma 비의존) — mock 불필요.

const NOW = new Date("2026-06-23T00:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  h.tx.team.findUnique.mockResolvedValue({ name: "A", active: true, leadUserId: null, updatedAt: NOW });
  h.tx.team.updateMany.mockResolvedValue({ count: 1 });
  h.tx.auditLog.create.mockResolvedValue({});
});

describe("팀장 불변식(F3)", () => {
  it("타 팀 사용자를 lead로 지정하면 거부", async () => {
    h.tx.user.findUnique.mockResolvedValue({ teamId: "teamB", status: "ACTIVE" });
    await expect(updateTeam("teamA", { leadUserId: "u1" }, NOW, "owner")).rejects.toThrow(/팀장은/);
    expect(h.tx.team.updateMany).not.toHaveBeenCalled();
  });
  it("비active 사용자를 lead로 지정하면 거부", async () => {
    h.tx.user.findUnique.mockResolvedValue({ teamId: "teamA", status: "DISABLED" });
    await expect(updateTeam("teamA", { leadUserId: "u1" }, NOW, "owner")).rejects.toThrow(/팀장은/);
  });
  it("같은 팀 active 소속원은 lead 지정 허용", async () => {
    h.tx.user.findUnique.mockResolvedValue({ teamId: "teamA", status: "ACTIVE" });
    await updateTeam("teamA", { leadUserId: "u1" }, NOW, "owner");
    expect(h.tx.team.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ leadUserId: "u1" }) }));
  });
  it("active=false로 바꾸면 lead 자동 해제", async () => {
    h.tx.user.findUnique.mockResolvedValue(null);
    await updateTeam("teamA", { active: false }, NOW, "owner");
    expect(h.tx.team.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ active: false, leadUserId: null }) }));
  });
});
```
(`updateTeam`은 `prisma.$transaction`만 mock하면 됨 — `expectedUpdatedAt` Date는 인자로 직접 전달.)

### 8. 통과 + 커밋

## Acceptance Criteria
- `npm test -- teams-service teams-catalog` → PASS.
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 errors (boundaries: modules/admin/teams는 admin 경계 내).
- `npm run prisma:validate` → valid (스키마 무변경, catalog만).
- 수동: OWNER로 `/admin/teams` 진입 → 팀 생성/이름변경/active 토글/팀장 지정 동작, 타 팀 사용자 lead 지정 시 422.

## Cautions
- **Don't** `leadUserId`를 authz 결정에 쓴다. Reason: 팀장은 라우팅/알림/표시용(D14). 인가는 scope 엔진만.
- **Don't** lead 불변식 검증을 생략. Reason: 무제약 lead + 알림 포함 → 교차팀 누수(F3). 항상 lead ∈ 해당 팀 active 소속원.
- **Don't** `reconcileTeamLeadTx`를 task-03에서 호출부에 못 박는다. Reason: 호출부(user-edit teamId 변경·user 비활성화)는 task-04. 여기선 helper만 제공하고 task-04가 wiring.
- **Don't** catalog의 `RESOURCES`/`NAV`를 task-06과 충돌나게 같은 줄에서 편집. Reason: task-06이 `admin.roles`를 같은 배열에 추가 — 다른 항목이라 충돌 없지만, 추가만 하고 기존 항목 재배열 금지(surgical).
