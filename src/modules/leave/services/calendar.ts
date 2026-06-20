import "server-only";
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
  canCrossDepartment: boolean; // status:view 또는 admin:view — 부서 경계 없이 타인 조회
  start: Date;
  end: Date;
  filterDepartment?: string | null;
}): Promise<LeaveCalendarEvent[]> {
  const { viewerId, canViewAllStatuses, canCrossDepartment, start, end } = params;
  const rangeAnd = [{ startDate: { lte: end } }, { endDate: { gte: start } }];

  // 부서 필터 → ACTIVE userId 목록. 부서 경계 권한자(status/admin)만 사용.
  let deptIds: string[] | null = null;
  if (canCrossDepartment && params.filterDepartment) {
    const us = await prisma.user.findMany({
      where: { department: params.filterDepartment, status: "ACTIVE" },
      select: { id: true },
    });
    deptIds = us.map((u) => u.id);
  }

  let where: Record<string, unknown>;
  if (canViewAllStatuses) {
    // admin: 전체 사용자·모든 상태·마스킹 없음. 부서 필터(선택).
    where = {
      deletedAt: null,
      AND: rangeAnd,
      ...(deptIds ? { userId: { in: deptIds } } : {}),
    };
  } else if (canCrossDepartment) {
    // status: 본인(전 상태) + 타인 APPROVED(전 부서 또는 필터). 타인은 마스킹·APPROVED-only —
    // 전 상태/사유 노출은 admin:view 전용(reason 등 민감정보 보호).
    const others = deptIds
      ? { userId: { in: deptIds.filter((id) => id !== viewerId) }, status: "APPROVED" as const }
      : { userId: { not: viewerId }, status: "APPROVED" as const };
    where = {
      deletedAt: null,
      AND: rangeAnd,
      OR: [{ userId: viewerId }, others],
    };
  } else {
    // 일반: 본인(전 상태) + 같은 부서 타인(APPROVED). 부서 null/빈 → self-only fail-closed.
    const me = await prisma.user.findUnique({ where: { id: viewerId }, select: { department: true } });
    const dept = me?.department?.trim();
    let deptOthers: string[] = [];
    if (dept) {
      const us = await prisma.user.findMany({
        where: { department: dept, status: "ACTIVE", id: { not: viewerId } },
        select: { id: true },
      });
      deptOthers = us.map((u) => u.id);
    }
    where = {
      deletedAt: null,
      AND: rangeAnd,
      OR: [
        { userId: viewerId },
        ...(deptOthers.length ? [{ userId: { in: deptOthers }, status: "APPROVED" as const }] : []),
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
