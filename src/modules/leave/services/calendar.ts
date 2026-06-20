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
  canCrossUserAllStatuses: boolean;
  start: Date;
  end: Date;
  filterDepartment?: string | null;
}): Promise<LeaveCalendarEvent[]> {
  const { viewerId, canCrossUserAllStatuses, start, end } = params;
  const rangeAnd = [{ startDate: { lte: end } }, { endDate: { gte: start } }];

  let where: Record<string, unknown>;
  if (canCrossUserAllStatuses) {
    // status/admin: 전체 사용자·모든 상태. 부서 필터는 서버에서만(선택).
    let deptIds: string[] | null = null;
    if (params.filterDepartment) {
      const us = await prisma.user.findMany({
        where: { department: params.filterDepartment, status: "ACTIVE" },
        select: { id: true },
      });
      deptIds = us.map((u) => u.id);
    }
    where = {
      deletedAt: null,
      AND: rangeAnd,
      ...(deptIds ? { userId: { in: deptIds } } : {}),
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
    const masked = !isSelf && !canCrossUserAllStatuses; // 권한 없는 타인: 사유·세부 가림(이름·유형만)
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
