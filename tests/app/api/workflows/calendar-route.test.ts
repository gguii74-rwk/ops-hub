import { describe, it, expect, beforeEach, vi } from "vitest";
import { normalizeToGridWindow } from "@/modules/calendar/time";

const h = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ user: { id: "u1", systemRole: "MEMBER" } } as any)),
  getPermissionSummary: vi.fn(async () => ({ keys: ["workflows.billing:view"] as string[] })),
  getCalendarTasks: vi.fn(async () => [] as any[]),
}));
vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...args: unknown[]) => unknown)(...a),
  ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } },
}));
vi.mock("@/modules/workflows/services/tasks", () => ({
  getCalendarTasks: (...a: unknown[]) => (h.getCalendarTasks as (...args: unknown[]) => unknown)(...a),
}));

import { GET } from "@/app/api/workflows/calendar/route";

// 현재월 그리드의 exclusive end(=winEnd, 클라가 보내는 값)
function monthAnchor(monthOffset: number): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset, 15, 3, 0, 0));
}
function gridKeys(monthOffset: number): { start: string; end: string } {
  const { start, end } = normalizeToGridWindow(monthAnchor(monthOffset));
  return { start: start.toISOString(), end: end.toISOString() }; // end = exclusive winEnd(R4·F2)
}
const url = (qs: string) => new Request(`http://x/api/workflows/calendar${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", systemRole: "MEMBER" } });
  h.getPermissionSummary.mockResolvedValue({ keys: ["workflows.billing:view"] });
  h.getCalendarTasks.mockResolvedValue([]);
});

describe("GET /api/workflows/calendar", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await GET(url(""))).status).toBe(401);
  });

  it("start/end 누락 → 400(전체 이력 반환 금지, D5)", async () => {
    expect((await GET(url(""))).status).toBe(400);
    expect(h.getCalendarTasks).not.toHaveBeenCalled();
  });

  it("빈 파라미터 → 400", async () => {
    expect((await GET(url("?start=&end="))).status).toBe(400);
  });

  it("비파싱 값 → 400", async () => {
    const { start } = gridKeys(0);
    expect((await GET(url(`?start=${start}&end=not-a-date`))).status).toBe(400);
  });

  it("start>=end(역순) → 400", async () => {
    const { start, end } = gridKeys(0);
    expect((await GET(url(`?start=${end}&end=${start}`))).status).toBe(400);
  });

  it("과대 span(>46일) → 400", async () => {
    // 운영창 안(현재월~+2개월)이어도 span(~59~62일)이 46일 cap 초과 → 400.
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1)).toISOString();
    expect((await GET(url(`?start=${start}&end=${end}`))).status).toBe(400);
  });

  it("운영창(now±13개월) 밖 → 400", async () => {
    // 2000년은 어떤 실행 시각에서도 밖
    expect((await GET(url("?start=2000-01-01T00:00:00.000Z&end=2000-01-05T00:00:00.000Z"))).status).toBe(400);
  });

  it("현재월 그리드(exclusive end) → 200 + getCalendarTasks에 Date range 전달", async () => {
    const { start, end } = gridKeys(0);
    const res = await GET(url(`?start=${start}&end=${end}`));
    expect(res.status).toBe(200);
    const [, range] = h.getCalendarTasks.mock.calls[0] as unknown as [unknown, { start: Date; end: Date }];
    expect(range.start.toISOString()).toBe(start);
    expect(range.end.toISOString()).toBe(end); // exclusive end 그대로(R4·F2)
  });

  it("+12개월 경계 그리드는 200(grid spillover 수용)", async () => {
    const { start, end } = gridKeys(12);
    expect((await GET(url(`?start=${start}&end=${end}`))).status).toBe(200);
  });

  it("+14개월 그리드는 400(+1 여유는 무제한 아님)", async () => {
    const { start, end } = gridKeys(14);
    expect((await GET(url(`?start=${start}&end=${end}`))).status).toBe(400);
  });

  it("200 응답은 {items} + no-store", async () => {
    h.getCalendarTasks.mockResolvedValueOnce([{ id: "t1", kind: "BILLING", typeName: "대금청구", scheduledAt: "2026-07-10T00:00:00.000Z", status: "PENDING" }]);
    const { start, end } = gridKeys(0);
    const res = await GET(url(`?start=${start}&end=${end}`));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });
});
