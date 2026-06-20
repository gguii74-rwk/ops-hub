import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { user: { count: vi.fn(), findMany: vi.fn() }, leaveRequest: { count: vi.fn(), findMany: vi.fn() } } }));
vi.mock("@/modules/leave/services/allocations", () => ({ getAllocationSummary: vi.fn() }));
vi.mock("@/modules/leave/repositories", () => ({ listRequests: vi.fn() }));

import { getEmployeeDashboard, getAdminDashboard } from "@/modules/leave/services/dashboard";
import { getAllocationSummary } from "@/modules/leave/services/allocations";
import { listRequests } from "@/modules/leave/repositories";
import { prisma } from "@/lib/prisma";

beforeEach(() => vi.clearAllMocks());

describe("getEmployeeDashboard", () => {
  it("사용률 = round(used/total*100), 최근 5건", async () => {
    vi.mocked(getAllocationSummary).mockResolvedValue({ year: 2026, allocatedDays: 15, carriedOverDays: 0, totalDays: 15, usedDays: 3, pendingDays: 0, remainingDays: 12, carriedOverExpiryDate: null });
    vi.mocked(listRequests).mockResolvedValue(Array.from({ length: 7 }, (_, i) => ({ id: `r${i}` })) as never);
    const out = await getEmployeeDashboard("u1");
    expect(out.usageRate).toBe(20);
    expect(out.recentRequests).toHaveLength(5);
  });
  it("할당 없으면 usageRate 0", async () => {
    vi.mocked(getAllocationSummary).mockResolvedValue(null);
    vi.mocked(listRequests).mockResolvedValue([] as never);
    const out = await getEmployeeDashboard("u1");
    expect(out.usageRate).toBe(0);
    expect(out.summary).toBeNull();
  });
});

describe("getAdminDashboard", () => {
  it("전체 인원·오늘 휴가중·대기 카운트", async () => {
    vi.mocked(prisma.user.count).mockResolvedValue(10 as never);
    vi.mocked(prisma.leaveRequest.count).mockResolvedValueOnce(2 as never).mockResolvedValueOnce(3 as never); // todayOnLeave, pending
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    const out = await getAdminDashboard();
    expect(out.totalEmployees).toBe(10);
    expect(out.todayOnLeave).toBe(2);
    expect(out.pendingRequests).toBe(3);
  });
});
