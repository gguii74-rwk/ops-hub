import "server-only";
import type { JobFunction } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface LeaveCalendarEvent {
  id: string;
  userId: string;
  name: string;
  leaveType: string;
  leaveSubType: string | null;
  quarterStartTime: string | null;
  startDate: Date;
  endDate: Date;
  status: string;
  reason: string | null;
  isSelf: boolean;
}

export async function getLeaveCalendar(params: {
  viewerId: string;
  canViewAllStatuses: boolean; // admin:view — 전 상태 + 타인 상세(사유·세부) 마스킹 해제
  canCrossTeam: boolean; // status:view 또는 admin:view — 팀 경계 없이 타인 조회
  start: Date;
  end: Date;
  filterTeamId?: string | null;
  job?: JobFunction | null; // 직무 필터(D1/D7) — null/미지정 = 무필터
}): Promise<LeaveCalendarEvent[]> {
  const { viewerId, canViewAllStatuses, canCrossTeam, start, end } = params;
  const rangeAnd = [{ startDate: { lte: end } }, { endDate: { gte: start } }];

  // 직무 필터(D1/D7): job 지정 시 그 jobFunction의 ACTIVE userId 집합과 AND 교집합.
  // LeaveRequest엔 user 관계가 없어 userId 집합으로 거른다(빈 집합 → {in:[]} → 빈 결과). jobFunction은 응답에 싣지 않음.
  const andClauses: Array<Record<string, unknown>> = [...rangeAnd];
  if (params.job) {
    const jobUsers = await prisma.user.findMany({
      where: { jobFunction: params.job, status: "ACTIVE" },
      select: { id: true },
    });
    andClauses.push({ userId: { in: jobUsers.map((u) => u.id) } });
  }

  // 팀 필터 → ACTIVE userId 목록. 팀 경계 권한자(status/admin)만 사용.
  let teamIds: string[] | null = null;
  if (canCrossTeam && params.filterTeamId) {
    const us = await prisma.user.findMany({
      where: { teamId: params.filterTeamId, status: "ACTIVE" },
      select: { id: true },
    });
    teamIds = us.map((u) => u.id);
  }

  let where: Record<string, unknown>;
  if (canViewAllStatuses) {
    // admin: 전체 사용자·모든 상태·마스킹 없음. 팀 필터(선택).
    where = {
      deletedAt: null,
      AND: andClauses,
      ...(teamIds ? { userId: { in: teamIds } } : {}),
    };
  } else if (canCrossTeam) {
    // status: 본인(전 상태) + 타인 APPROVED(전 팀 또는 필터). 타인은 마스킹·APPROVED-only —
    // 전 상태/사유 노출은 admin:view 전용(reason 등 민감정보 보호).
    const others = teamIds
      ? { userId: { in: teamIds.filter((id) => id !== viewerId) }, status: "APPROVED" as const }
      : { userId: { not: viewerId }, status: "APPROVED" as const };
    where = {
      deletedAt: null,
      AND: andClauses,
      OR: [{ userId: viewerId }, others],
    };
  } else {
    // 일반: 본인(전 상태) + 같은 팀 타인(APPROVED). teamId null/없음 → self-only fail-closed.
    const me = await prisma.user.findUnique({ where: { id: viewerId }, select: { teamId: true } });
    const myTeamId = me?.teamId ?? null;
    let teamOthers: string[] = [];
    if (myTeamId) {
      const us = await prisma.user.findMany({
        where: { teamId: myTeamId, status: "ACTIVE", id: { not: viewerId } },
        select: { id: true },
      });
      teamOthers = us.map((u) => u.id);
    }
    where = {
      deletedAt: null,
      AND: andClauses,
      OR: [
        { userId: viewerId },
        ...(teamOthers.length ? [{ userId: { in: teamOthers }, status: "APPROVED" as const }] : []),
      ],
    };
  }

  const rows = await prisma.leaveRequest.findMany({
    where,
    select: {
      id: true,
      userId: true,
      leaveType: true,
      leaveSubType: true,
      quarterStartTime: true,
      startDate: true,
      endDate: true,
      status: true,
      reason: true,
    },
    orderBy: { startDate: "asc" },
  });

  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return rows.map((e) => {
    const isSelf = e.userId === viewerId;
    const masked = !isSelf && !canViewAllStatuses; // admin:view 외에는 타인 사유·세부 가림(이름·유형만)
    return {
      id: e.id,
      userId: e.userId,
      name: nameById.get(e.userId) ?? "직원",
      leaveType: e.leaveType,
      leaveSubType: masked ? null : (e.leaveSubType ?? null),
      quarterStartTime: masked ? null : (e.quarterStartTime ?? null),
      startDate: e.startDate,
      endDate: e.endDate,
      status: e.status,
      reason: masked ? null : (e.reason ?? null),
      isSelf,
    };
  });
}
