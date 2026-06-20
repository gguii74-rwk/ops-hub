import "server-only";
import { prisma } from "@/lib/prisma";

export interface EmployeeStatus {
  id: string;
  name: string;
  email: string;
  department: string | null;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
}

export async function getAllEmployeesStatus(year: number): Promise<EmployeeStatus[]> {
  const [users, allocs, pendings] = await Promise.all([
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, email: true, department: true },
      orderBy: { name: "asc" },
    }),
    prisma.leaveAllocation.findMany({
      where: { year },
      select: { userId: true, allocatedDays: true, carriedOverDays: true, usedDays: true },
    }),
    prisma.leaveRequest.groupBy({
      by: ["userId"],
      where: {
        status: "PENDING",
        deletedAt: null,
        startDate: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lte: new Date(Date.UTC(year, 11, 31)),
        },
      },
      _sum: { days: true },
    }),
  ]);

  const allocById = new Map(allocs.map((a) => [a.userId, a]));
  const pendById = new Map(
    pendings.map((p) => [p.userId, p._sum.days ? Number(p._sum.days) : 0]),
  );

  return users.map((u) => {
    const a = allocById.get(u.id);
    const totalDays = a ? Number(a.allocatedDays) + Number(a.carriedOverDays) : 0;
    const usedDays = a ? Number(a.usedDays) : 0;
    const pendingDays = pendById.get(u.id) ?? 0;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      department: u.department,
      totalDays,
      usedDays,
      pendingDays,
      remainingDays: totalDays - usedDays - pendingDays,
    };
  });
}
