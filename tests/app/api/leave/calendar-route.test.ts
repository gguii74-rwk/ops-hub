import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "u1", systemRole: "MEMBER" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: [] as string[] })),
    getLeaveCalendar: vi.fn(async () => []),
    getHolidayEventsInRange: vi.fn(async () => [] as { date: string; name: string }[]),
    getUnsyncedYears: vi.fn(async () => [] as number[]),
    FakeForbidden,
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  requirePermission: (...a: unknown[]) => (h.requirePermission as (...args: unknown[]) => unknown)(...a),
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...args: unknown[]) => unknown)(...a),
  ForbiddenError: h.FakeForbidden,
}));
vi.mock("@/modules/leave/services/calendar", () => ({
  getLeaveCalendar: (...a: unknown[]) => (h.getLeaveCalendar as (...args: unknown[]) => unknown)(...a),
}));
vi.mock("@/kernel/holidays", () => ({
  getHolidayEventsInRange: (...a: unknown[]) => (h.getHolidayEventsInRange as (...args: unknown[]) => unknown)(...a),
  getUnsyncedYears: (...a: unknown[]) => (h.getUnsyncedYears as (...args: unknown[]) => unknown)(...a),
}));

import { GET } from "@/app/api/leave/calendar/route";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function yearsSpanned(startKey: string, endKey: string): number[] {
  const ys: number[] = [];
  for (let y = Number(startKey.slice(0, 4)); y <= Number(endKey.slice(0, 4)); y++) ys.push(y);
  return ys;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", systemRole: "MEMBER" } });
  h.getPermissionSummary.mockResolvedValue({ keys: [] });
  h.getLeaveCalendar.mockResolvedValue([]);
  h.getHolidayEventsInRange.mockResolvedValue([]);
  h.getUnsyncedYears.mockResolvedValue([]);
});

describe("GET /api/leave/calendar", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x/api/leave/calendar"));
    expect(res.status).toBe(401);
  });

  // read-only(D8) 증명: 아래 @/kernel/holidays mock은 getHolidayEventsInRange/getUnsyncedYears만 노출한다.
  // 라우트가 ensureYearsSynced/syncHolidaysForYear를 호출하면 "is not a function"으로 크래시 → 이 happy-path가 그 부재를 보증.
  it("happy-path 200 + {events,holidays,unsyncedYears}(동기화 미호출=read-only)", async () => {
    h.getHolidayEventsInRange.mockResolvedValueOnce([{ date: daysFromNow(5), name: "테스트공휴일" }]);
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${daysFromNow(0)}&end=${daysFromNow(20)}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(Array.isArray(body.holidays)).toBe(true);
    expect(body.holidays).toHaveLength(1);
    expect(Array.isArray(body.unsyncedYears)).toBe(true);
    expect(h.requirePermission).toHaveBeenCalledWith("u1", "leave.request", "view");
  });

  it("미적재 연도는 unsyncedYears에 담김(getUnsyncedYears 결과 그대로)", async () => {
    const start = daysFromNow(0);
    const want = [Number(start.slice(0, 4))];
    h.getUnsyncedYears.mockResolvedValueOnce(want);
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${start}&end=${daysFromNow(20)}`));
    const body = await res.json();
    expect(body.unsyncedYears).toEqual(want);
  });

  it("권한 없음 403", async () => {
    const { ForbiddenError } = await import("@/kernel/access");
    h.requirePermission.mockRejectedValueOnce(new ForbiddenError());
    const res = await GET(new Request("http://x/api/leave/calendar"));
    expect(res.status).toBe(403);
  });

  it("일반 사용자는 canViewAllStatuses=false·canCrossTeam=false, teamId 무시", async () => {
    h.getPermissionSummary.mockResolvedValueOnce({ keys: [] });
    await GET(new Request("http://x/api/leave/calendar?teamId=team1"));
    expect(h.getLeaveCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ canViewAllStatuses: false, canCrossTeam: false, filterTeamId: null }),
    );
  });

  it("status:view는 canCrossTeam=true이지만 canViewAllStatuses=false(전상태·마스킹 해제 금지)", async () => {
    h.getPermissionSummary.mockResolvedValueOnce({ keys: ["leave.status:view"] });
    await GET(new Request("http://x/api/leave/calendar?teamId=team1"));
    expect(h.getLeaveCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ canViewAllStatuses: false, canCrossTeam: true, filterTeamId: "team1" }),
    );
  });

  it("admin:view는 canViewAllStatuses=true·canCrossTeam=true", async () => {
    h.getPermissionSummary.mockResolvedValueOnce({ keys: ["leave.admin:view"] });
    await GET(new Request("http://x/api/leave/calendar"));
    expect(h.getLeaveCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ canViewAllStatuses: true, canCrossTeam: true }),
    );
  });

  // D10 윈도우 검증
  it("end < start → 400", async () => {
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${daysFromNow(10)}&end=${daysFromNow(0)}`));
    expect(res.status).toBe(400);
  });
  it("일수 상한 초과(>46일) → 400", async () => {
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${daysFromNow(0)}&end=${daysFromNow(89)}`));
    expect(res.status).toBe(400);
  });
  it("운영 창(now±MAX_ANCHOR_MONTHS) 밖 → 400", async () => {
    // 2000년은 어떤 현실적 실행 시각에서도 ±12개월 밖(하드코딩 안전).
    const res = await GET(new Request("http://x/api/leave/calendar?start=2000-01-01&end=2000-01-31"));
    expect(res.status).toBe(400);
  });

  // D7 job 검증
  it("job 화이트리스트 값은 서비스에 전달", async () => {
    await GET(new Request(`http://x/api/leave/calendar?start=${daysFromNow(0)}&end=${daysFromNow(20)}&job=DEVELOPER`));
    expect(h.getLeaveCalendar).toHaveBeenCalledWith(expect.objectContaining({ job: "DEVELOPER" }));
  });
  it("job=ALL/없음은 무필터(null) 전달", async () => {
    await GET(new Request(`http://x/api/leave/calendar?start=${daysFromNow(0)}&end=${daysFromNow(20)}&job=ALL`));
    expect(h.getLeaveCalendar).toHaveBeenCalledWith(expect.objectContaining({ job: null }));
  });
  it("job 화이트리스트 외 값 → 400", async () => {
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${daysFromNow(0)}&end=${daysFromNow(20)}&job=PM`));
    expect(res.status).toBe(400);
  });

  // D9 불변식: 공휴일 조회 실패가 깨끗한 빈 상태로 둔갑하지 않음 — 윈도우 전체 연도를 신호
  it("getHolidayEventsInRange throw 시 holidays:[] + unsyncedYears=윈도우 전체 연도", async () => {
    h.getHolidayEventsInRange.mockRejectedValueOnce(new Error("db down"));
    const start = daysFromNow(0);
    const end = daysFromNow(20);
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${start}&end=${end}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holidays).toEqual([]);
    expect(body.unsyncedYears).toEqual(yearsSpanned(start, end)); // 보수적: 윈도우 전체 연도
  });
  it("getUnsyncedYears throw 시에도 동일 degraded 신호", async () => {
    h.getUnsyncedYears.mockRejectedValueOnce(new Error("count fail"));
    const start = daysFromNow(0);
    const end = daysFromNow(20);
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${start}&end=${end}`));
    const body = await res.json();
    expect(body.holidays).toEqual([]);
    expect(body.unsyncedYears).toEqual(yearsSpanned(start, end));
  });
});
