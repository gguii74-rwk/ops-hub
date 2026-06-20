import "server-only";
import { prisma } from "@/lib/prisma";
import { getAllocationSummary } from "./allocations";
import { listRequests } from "../repositories";
import { kstToday } from "../rules";
import type { AllocationSummary } from "../types";

export interface EmployeeDashboard {
  summary: AllocationSummary | null;
  usageRate: number;
  recentRequests: Awaited<ReturnType<typeof listRequests>>;
}

export async function getEmployeeDashboard(userId: string): Promise<EmployeeDashboard> {
  const year = kstToday(new Date()).getUTCFullYear();
  const summary = await getAllocationSummary(userId, year);
  const all = await listRequests({ userId });
  const recentRequests = all.slice(0, 5);
  const usageRate =
    summary && summary.totalDays > 0
      ? Math.round((summary.usedDays / summary.totalDays) * 100)
      : 0;
  return { summary, usageRate, recentRequests };
}

export interface LeavePerson {
  userId: string;
  name: string;
  leaveType: string;
  leaveSubType: string | null;
  quarterStartTime: string | null;
  startDate: Date;
  endDate: Date;
}

export interface AdminDashboard {
  totalEmployees: number;
  todayOnLeave: number;
  pendingRequests: number;
  today: LeavePerson[];
  tomorrow: LeavePerson[];
  upcoming: LeavePerson[];
}

async function approvedCovering(from: Date, to: Date): Promise<LeavePerson[]> {
  const items = await prisma.leaveRequest.findMany({
    where: {
      status: "APPROVED",
      deletedAt: null,
      AND: [{ startDate: { lte: to } }, { endDate: { gte: from } }],
    },
    select: {
      userId: true,
      leaveType: true,
      leaveSubType: true,
      quarterStartTime: true,
      startDate: true,
      endDate: true,
    },
    orderBy: { startDate: "asc" },
  });
  if (items.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(items.map((i) => i.userId))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return items.map((i) => ({
    ...i,
    leaveSubType: i.leaveSubType ?? null,
    quarterStartTime: i.quarterStartTime ?? null,
    name: nameById.get(i.userId) ?? i.userId,
  }));
}

export async function getAdminDashboard(): Promise<AdminDashboard> {
  const today = kstToday(new Date());
  const day = 24 * 60 * 60 * 1000;
  const tomorrow = new Date(today.getTime() + day);
  const weekEnd = new Date(today.getTime() + 7 * day);

  const [totalEmployees, todayOnLeave, pendingRequests, todayList, tomorrowList, upcomingList] =
    await Promise.all([
      prisma.user.count({ where: { status: "ACTIVE" } }),
      prisma.leaveRequest.count({
        where: {
          status: "APPROVED",
          deletedAt: null,
          AND: [{ startDate: { lte: today } }, { endDate: { gte: today } }],
        },
      }),
      prisma.leaveRequest.count({ where: { status: "PENDING", deletedAt: null } }),
      approvedCovering(today, today),
      approvedCovering(tomorrow, tomorrow),
      approvedCovering(new Date(today.getTime() + 2 * day), weekEnd),
    ]);

  return {
    totalEmployees,
    todayOnLeave,
    pendingRequests,
    today: todayList,
    tomorrow: tomorrowList,
    upcoming: upcomingList,
  };
}
