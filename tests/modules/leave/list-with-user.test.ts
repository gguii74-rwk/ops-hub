import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: vi.fn() } } }));
vi.mock("@/kernel/holidays", () => ({ getHolidaysInRange: vi.fn(), ensureYearsSynced: vi.fn(), getUnsyncedYears: vi.fn() }));
vi.mock("@/modules/leave/repositories", () => ({
  getRequestById: vi.fn(), listRequests: vi.fn(), findActiveAllocation: vi.fn(), findOverlap: vi.fn(),
  createPendingRequest: vi.fn(), createApprovedRequestTx: vi.fn(), approveTx: vi.fn(), rejectRequest: vi.fn(),
  cancelTx: vi.fn(), updateByAdminTx: vi.fn(), deleteByAdminTx: vi.fn(),
}));

import { listAllRequestsWithUser } from "@/modules/leave/services/requests";
import * as repo from "@/modules/leave/repositories";
import { prisma } from "@/lib/prisma";

beforeEach(() => vi.clearAllMocks());

describe("listAllRequestsWithUser", () => {
  it("요청에 user(name/teamId/team/email)를 병합", async () => {
    vi.mocked(repo.listRequests).mockResolvedValue([
      { id: "r1", userId: "u1" }, { id: "r2", userId: "u2" },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", name: "김", teamId: "t1", team: { name: "개발팀" }, email: "k@x.com" },
      { id: "u2", name: "이", teamId: "t2", team: { name: "기획팀" }, email: "l@x.com" },
    ] as never);
    const out = await listAllRequestsWithUser({ statuses: ["PENDING"] });
    expect(out[0]).toMatchObject({ id: "r1", user: { name: "김", teamId: "t1", team: { name: "개발팀" } } });
    expect(out[1].user?.name).toBe("이");
  });
  it("user 못 찾으면 user=null", async () => {
    vi.mocked(repo.listRequests).mockResolvedValue([{ id: "r1", userId: "u9" }] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    const out = await listAllRequestsWithUser({});
    expect(out[0].user).toBeNull();
  });
});
