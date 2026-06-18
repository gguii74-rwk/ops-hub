import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.hoisted: mock factory가 TDZ로 접근하지 못하도록 session, mock fn, FakeForbidden을 hoisted 객체에 올림.
// session은 getter/setter로 노출해 beforeEach + 테스트에서 재할당 가능하게 한다.
const h = vi.hoisted(() => {
  let _session: any = { user: { id: "u1" } };

  class FakeForbidden extends Error {}

  return {
    getSession: () => _session,
    setSession: (v: any) => { _session = v; },
    FakeForbidden,
    requirePermission: vi.fn(async (_u: string, _r: string, _a: string) => {}),
    listSettings: vi.fn(),
    setSetting: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ auth: async () => h.getSession() }));

vi.mock("@/kernel/access", () => ({
  ForbiddenError: h.FakeForbidden,
  requirePermission: (u: string, r: string, a: string) => h.requirePermission(u, r, a),
}));

vi.mock("@/kernel/settings", () => ({
  listSettings: (...a: any[]) => h.listSettings(...a),
  setSetting: (...a: any[]) => h.setSetting(...a),
}));

vi.mock("@/kernel/settings/catalog", () => ({
  getEntry: (key: string) =>
    key === "integrations.smtp.host"
      ? { kind: "systemSetting", key, permission: { resource: "integrations.smtp", action: "configure" } }
      : undefined,
}));

import {
  UnknownSettingError, SettingNotWritableError, SettingValidationError, SettingConcurrencyError,
} from "@/kernel/settings/registry";
import { GET } from "@/app/api/admin/settings/route";
import { PUT } from "@/app/api/admin/settings/[key]/route";

const putReq = (body: unknown) =>
  new Request("http://t/api/admin/settings/integrations.smtp.host", { method: "PUT", body: JSON.stringify(body) });
const ctx = (key: string) => ({ params: Promise.resolve({ key }) });

beforeEach(() => {
  h.setSession({ user: { id: "u1" } });
  h.requirePermission.mockReset().mockResolvedValue(undefined);
  h.listSettings.mockReset();
  h.setSetting.mockReset();
});

describe("GET /api/admin/settings", () => {
  it("미인증 → 401", async () => {
    h.setSession(null);
    expect((await GET()).status).toBe(401);
  });
  it("admin 게이트 실패(ForbiddenError) → 403", async () => {
    h.listSettings.mockRejectedValue(new h.FakeForbidden());
    expect((await GET()).status).toBe(403);
  });
  it("성공 → 200 + items", async () => {
    h.listSettings.mockResolvedValue([{ key: "integrations.smtp.host", status: "OK" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

describe("PUT /api/admin/settings/[key]", () => {
  it("미인증 → 401", async () => {
    h.setSession(null);
    expect((await PUT(putReq({ value: "x" }), ctx("integrations.smtp.host"))).status).toBe(401);
  });
  it("미등록 key → 404", async () => {
    expect((await PUT(putReq({ value: "x" }), ctx("nope.nope.nope"))).status).toBe(404);
  });
  it("권한 없음(엔트리 게이트 throw) → 403", async () => {
    h.requirePermission.mockImplementation(async (_u: string, r: string) => { if (r === "integrations.smtp") throw new h.FakeForbidden(); });
    expect((await PUT(putReq({ value: "x", expectedUpdatedAt: null }), ctx("integrations.smtp.host"))).status).toBe(403);
  });
  it("비관리자(admin.settings:configure 없음)는 무효 키도 403(404 아님), setSetting 미호출", async () => {
    h.requirePermission.mockImplementation(async (_u: string, r: string) => { if (r === "admin.settings") throw new h.FakeForbidden(); });
    const res = await PUT(putReq({ value: "x", expectedUpdatedAt: null }), ctx("nope.nope.nope"));
    expect(res.status).toBe(403);
    expect(h.setSetting).not.toHaveBeenCalled();
  });
  it("성공 → 200 + updatedAt, base+entry 게이트 모두 호출", async () => {
    h.setSetting.mockResolvedValue({ updatedAt: new Date(2026, 0, 2) });
    const res = await PUT(putReq({ value: "mail.x", expectedUpdatedAt: null }), ctx("integrations.smtp.host"));
    expect(res.status).toBe(200);
    expect(h.requirePermission).toHaveBeenCalledWith("u1", "admin.settings", "configure");
    expect(h.requirePermission).toHaveBeenCalledWith("u1", "integrations.smtp", "configure");
    expect(h.setSetting).toHaveBeenCalledWith("integrations.smtp.host", "mail.x", { actorId: "u1", expectedUpdatedAt: null });
  });
  it("Zod 실패 → 422", async () => {
    h.setSetting.mockRejectedValue(new SettingValidationError("integrations.smtp.host", "bad"));
    expect((await PUT(putReq({ value: 1, expectedUpdatedAt: null }), ctx("integrations.smtp.host"))).status).toBe(422);
  });
  it("concurrency → 409", async () => {
    h.setSetting.mockRejectedValue(new SettingConcurrencyError("integrations.smtp.host"));
    expect((await PUT(putReq({ value: "x", expectedUpdatedAt: "2020-01-01" }), ctx("integrations.smtp.host"))).status).toBe(409);
  });
  it("not writable → 400", async () => {
    h.setSetting.mockRejectedValue(new SettingNotWritableError("integrations.smtp.host"));
    expect((await PUT(putReq({ value: "x", expectedUpdatedAt: null }), ctx("integrations.smtp.host"))).status).toBe(400);
  });
  it("expectedUpdatedAt 생략 → 400(LWW 우회 차단), setSetting 미호출", async () => {
    const res = await PUT(putReq({ value: "x" }), ctx("integrations.smtp.host"));
    expect(res.status).toBe(400);
    expect(h.setSetting).not.toHaveBeenCalled();
  });
  it("expectedUpdatedAt 형식 오류 → 400", async () => {
    const res = await PUT(putReq({ value: "x", expectedUpdatedAt: "not-a-date" }), ctx("integrations.smtp.host"));
    expect(res.status).toBe(400);
    expect(h.setSetting).not.toHaveBeenCalled();
  });
});
