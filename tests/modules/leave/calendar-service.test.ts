import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn(), findMany: vi.fn() }, leaveRequest: { findMany: vi.fn() } } }));
import { getLeaveCalendar } from "@/modules/leave/services/calendar";
import { prisma } from "@/lib/prisma";
beforeEach(() => vi.clearAllMocks());

const range = { start: new Date("2026-07-01T00:00:00Z"), end: new Date("2026-07-31T00:00:00Z") };

function getFirstCallWhere(): Record<string, unknown> {
  const calls = vi.mocked(prisma.leaveRequest.findMany).mock.calls;
  const arg = (calls[0] as [{ where: Record<string, unknown> }])[0];
  return arg.where;
}

describe("getLeaveCalendar — 일반 사용자(self)", () => {
  it("부서 있으면 본인(전상태) OR 같은부서 타인(APPROVED)로 조회", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ department: "개발" } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u2" }] as never); // dept others
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // names
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossDepartment: false, ...range });
    const where = getFirstCallWhere();
    expect(where.OR).toEqual(expect.arrayContaining([
      { userId: "u1" }, { userId: { in: ["u2"] }, status: "APPROVED" },
    ]));
  });
  it("부서 null이면 self-only(OR에 본인만)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ department: null } as never);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossDepartment: false, ...range });
    const where = getFirstCallWhere();
    expect(where.OR).toEqual([{ userId: "u1" }]);
  });
  it("타인 APPROVED 항목의 사유·세부를 마스킹", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ department: "개발" } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u2" }] as never);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      { id: "r2", userId: "u2", leaveType: "QUARTER", leaveSubType: null, quarterStartTime: "09:00", startDate: range.start, endDate: range.start, status: "APPROVED", reason: "비밀" },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u2", name: "이" }] as never);
    const ev = await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossDepartment: false, ...range });
    expect(ev[0]).toMatchObject({ name: "이", leaveType: "QUARTER", reason: null, quarterStartTime: null, isSelf: false });
  });
});

describe("getLeaveCalendar — status:view(부서경계 없음·APPROVED-only·마스킹)", () => {
  it("필터 없으면 본인(전상태) OR 전부서 타인(APPROVED)로 조회 — 부서조회 안 함", async () => {
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never); // names only
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossDepartment: true, ...range });
    const where = getFirstCallWhere();
    expect(where.OR).toEqual([
      { userId: "u1" }, { userId: { not: "u1" }, status: "APPROVED" },
    ]);
    expect(vi.mocked(prisma.user.findUnique)).not.toHaveBeenCalled(); // 본인 부서 조회 불필요
  });
  it("타인 PENDING의 사유를 노출하지 않는다(status는 마스킹·APPROVED-only)", async () => {
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      { id: "r3", userId: "u3", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null, startDate: range.start, endDate: range.start, status: "APPROVED", reason: "사유" },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u3", name: "박" }] as never);
    const ev = await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossDepartment: true, ...range });
    expect(ev[0]).toMatchObject({ name: "박", reason: null, isSelf: false });
  });
  it("부서 필터 주면 해당 부서 타인 APPROVED로 한정", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u4" }, { id: "u1" }] as never); // dept members(자기 포함)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // names
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossDepartment: true, filterDepartment: "개발", ...range });
    const where = getFirstCallWhere();
    expect(where.OR).toEqual([
      { userId: "u1" }, { userId: { in: ["u4"] }, status: "APPROVED" }, // 자기 id는 others에서 제외
    ]);
  });
});

describe("getLeaveCalendar — admin:view(전체·전상태·마스킹 해제)", () => {
  it("전체·전상태로 조회하고 마스킹 안 함", async () => {
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      { id: "r5", userId: "u5", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null, startDate: range.start, endDate: range.start, status: "PENDING", reason: "사유" },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u5", name: "최" }] as never);
    const ev = await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: true, canCrossDepartment: true, ...range });
    expect(ev[0]).toMatchObject({ reason: "사유", isSelf: false });
    const where = getFirstCallWhere();
    expect(where.OR).toBeUndefined();
  });
  it("부서 필터 주면 userId in 으로 한정", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "ux" }] as never); // dept members
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // names
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: true, canCrossDepartment: true, filterDepartment: "개발", ...range });
    const where = getFirstCallWhere();
    expect(where.userId).toEqual({ in: ["ux"] });
    expect(where.OR).toBeUndefined();
  });
});
