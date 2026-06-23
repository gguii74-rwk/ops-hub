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

// 팀 배정 셀렉트용(사용자 관리 폼). active 팀만, 이름순.
export function listActiveTeamOptions(): Promise<Array<{ id: string; name: string }>> {
  return prisma.team.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
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
        // 후보 user 행을 잠가(FOR UPDATE) 동시 멤버십 이동(task-04 user-edit teamId 변경·reconcileTeamLeadTx)과 직렬화한다(F-E).
        // 잠금 없이 plain read로 검증하면, 검증 후 leadUserId 쓰기 전에 후보가 다른 팀으로 이동해 교차팀 lead가 남고
        // 알림 수신자(D12④)가 타 팀에 샌다(F3 race 재현). user-edit의 teamId UPDATE도 같은 행을 잠그므로 직렬화된다.
        await tx.$queryRaw`SELECT 1 FROM "kernel"."User" WHERE "id" = ${patch.leadUserId} FOR UPDATE`;
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
