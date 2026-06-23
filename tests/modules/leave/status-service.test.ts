import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    leaveAllocation: { findMany: vi.fn() },
    leaveRequest: { groupBy: vi.fn() },
  },
}));

import { getAllEmployeesStatus } from "@/modules/leave/services/status";
import { prisma } from "@/lib/prisma";

beforeEach(() => vi.clearAllMocks());

describe("getAllEmployeesStatus", () => {
  it("할당·대기 병합 후 잔여 계산", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", name: "김", email: "k@x.com", teamId: "t1", team: { name: "개발팀" } },
    ] as never);
    vi.mocked(prisma.leaveAllocation.findMany).mockResolvedValue([
      { userId: "u1", allocatedDays: 15, carriedOverDays: 2, usedDays: 5 },
    ] as never);
    vi.mocked(prisma.leaveRequest.groupBy).mockResolvedValue([
      { userId: "u1", _sum: { days: 1 } },
    ] as never);
    const out = await getAllEmployeesStatus(2026);
    expect(out[0]).toMatchObject({
      name: "김",
      teamName: "개발팀",
      totalDays: 17,
      usedDays: 5,
      pendingDays: 1,
      remainingDays: 11,
    });
  });

  it("할당 없는 사용자는 0/0/0", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u2", name: "이", email: "l@x.com", teamId: null, team: null },
    ] as never);
    vi.mocked(prisma.leaveAllocation.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.leaveRequest.groupBy).mockResolvedValue([] as never);
    const out = await getAllEmployeesStatus(2026);
    expect(out[0]).toMatchObject({
      teamName: null,
      totalDays: 0,
      usedDays: 0,
      pendingDays: 0,
      remainingDays: 0,
    });
  });
});
