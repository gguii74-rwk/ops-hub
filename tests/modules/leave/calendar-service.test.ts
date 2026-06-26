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
  it("팀 있으면 본인(전상태) OR 같은팀 타인(APPROVED)로 조회", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ teamId: "team1" } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u2" }] as never); // team others
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // names
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossTeam: false, ...range });
    const where = getFirstCallWhere();
    expect(where.OR).toEqual(expect.arrayContaining([
      { userId: "u1" }, { userId: { in: ["u2"] }, status: "APPROVED" },
    ]));
  });
  it("팀 null이면 self-only(OR에 본인만)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ teamId: null } as never);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossTeam: false, ...range });
    const where = getFirstCallWhere();
    expect(where.OR).toEqual([{ userId: "u1" }]);
  });
  it("타인 APPROVED 항목의 사유·세부를 마스킹", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ teamId: "team1" } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u2" }] as never);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      { id: "r2", userId: "u2", leaveType: "QUARTER", leaveSubType: null, quarterStartTime: "09:00", startDate: range.start, endDate: range.start, status: "APPROVED", reason: "비밀" },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u2", name: "이" }] as never);
    const ev = await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossTeam: false, ...range });
    expect(ev[0]).toMatchObject({ name: "이", leaveType: "QUARTER", reason: null, quarterStartTime: null, isSelf: false });
  });
});

describe("getLeaveCalendar — status:view(팀경계 없음·APPROVED-only·마스킹)", () => {
  it("필터 없으면 본인(전상태) OR 전팀 타인(APPROVED)로 조회 — 팀조회 안 함", async () => {
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never); // names only
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossTeam: true, ...range });
    const where = getFirstCallWhere();
    expect(where.OR).toEqual([
      { userId: "u1" }, { userId: { not: "u1" }, status: "APPROVED" },
    ]);
    expect(vi.mocked(prisma.user.findUnique)).not.toHaveBeenCalled(); // 본인 팀 조회 불필요
  });
  it("타인 PENDING의 사유를 노출하지 않는다(status는 마스킹·APPROVED-only)", async () => {
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      { id: "r3", userId: "u3", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null, startDate: range.start, endDate: range.start, status: "APPROVED", reason: "사유" },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u3", name: "박" }] as never);
    const ev = await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossTeam: true, ...range });
    expect(ev[0]).toMatchObject({ name: "박", reason: null, isSelf: false });
  });
  it("팀 필터 주면 해당 팀 타인 APPROVED로 한정", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u4" }, { id: "u1" }] as never); // team members(자기 포함)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // names
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossTeam: true, filterTeamId: "team1", ...range });
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
    const ev = await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: true, canCrossTeam: true, ...range });
    expect(ev[0]).toMatchObject({ reason: "사유", isSelf: false });
    const where = getFirstCallWhere();
    expect(where.OR).toBeUndefined();
  });
  it("팀 필터 주면 userId in 으로 한정", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "ux" }] as never); // team members
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // names
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: true, canCrossTeam: true, filterTeamId: "team1", ...range });
    const where = getFirstCallWhere();
    expect(where.userId).toEqual({ in: ["ux"] });
    expect(where.OR).toBeUndefined();
  });
});

import type { JobFunction } from "@prisma/client";

describe("getLeaveCalendar — 직무 필터(job, 서버 교집합·jobFunction 미노출)", () => {
  it("admin + job: jobFunction ACTIVE userId 집합을 AND로 교집합(rangeAnd에 추가)", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "dev1" }, { id: "dev2" }] as never); // 직무 userId
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // names
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: true, canCrossTeam: true, job: "DEVELOPER" as JobFunction, ...range });
    expect(vi.mocked(prisma.user.findMany)).toHaveBeenNthCalledWith(1, {
      where: { jobFunction: "DEVELOPER", status: "ACTIVE" },
      select: { id: true },
    });
    const where = getFirstCallWhere();
    expect(where.AND).toEqual(expect.arrayContaining([{ userId: { in: ["dev1", "dev2"] } }]));
  });

  it("빈 직무 집합이면 AND에 {userId:{in:[]}} — 빈 결과", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // 직무 userId 없음
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // names
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: true, canCrossTeam: true, job: "CONTENT_MANAGER" as JobFunction, ...range });
    const where = getFirstCallWhere();
    expect(where.AND).toEqual(expect.arrayContaining([{ userId: { in: [] } }]));
  });

  it("job 없음(미지정)이면 직무 user 조회 안 함 + AND에 직무 제약 없음", async () => {
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never); // names only
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: true, canCrossTeam: true, ...range });
    const where = getFirstCallWhere();
    // AND엔 rangeAnd(2건)만 — 직무 제약 미포함
    expect((where.AND as unknown[]).some((c) => JSON.stringify(c).includes("userId"))).toBe(false);
  });

  it("일반(self) + job: 직무 user 조회가 먼저, 그 다음 팀 조회(findUnique)·이름", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "dev1" }] as never); // ① 직무 userId
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ teamId: "team1" } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u2" }] as never); // ② 팀 others
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // ③ names
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossTeam: false, job: "DEVELOPER" as JobFunction, ...range });
    const where = getFirstCallWhere();
    expect(where.AND).toEqual(expect.arrayContaining([{ userId: { in: ["dev1"] } }]));
    expect(where.OR).toEqual(expect.arrayContaining([{ userId: "u1" }])); // self OR 유지
  });

  it("반환 이벤트에 jobFunction 필드가 없다(D7)", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "dev1" }] as never); // 직무 userId
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      { id: "r1", userId: "dev1", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null, startDate: range.start, endDate: range.start, status: "APPROVED", reason: null },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "dev1", name: "김" }] as never); // names
    const ev = await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: true, canCrossTeam: true, job: "DEVELOPER" as JobFunction, ...range });
    expect(ev[0]).not.toHaveProperty("jobFunction");
  });
});
