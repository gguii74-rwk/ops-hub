import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  let session: any = { user: { id: "u1", systemRole: "MEMBER", email: "u1@x", name: "U1", employmentType: "REGULAR", jobFunction: "PM" } };
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    getSession: () => session,
    setSession: (v: any) => { session = v; },
    FakeForbidden,
    getPermissionSummary: vi.fn(async (..._a: unknown[]) => ({ keys: [] as string[], isOwner: false, isAdmin: false })),
    getTaskList: vi.fn(async (..._a: unknown[]) => [] as any[]),
    getTaskDetailView: vi.fn(async (..._a: unknown[]) => null as any),
    createTask: vi.fn(async (..._a: unknown[]) => ({ id: "new" })),
    cancelTask: vi.fn(async (..._a: unknown[]) => undefined),
    retryDelivery: vi.fn(async (..._a: unknown[]) => ({ id: "d1", status: "SENT" })),
    resolveDelivery: vi.fn(async (..._a: unknown[]) => ({ id: "d1", status: "FAILED" })),
  };
});

vi.mock("@/lib/auth", () => ({ auth: async () => h.getSession() }));
vi.mock("@/kernel/access", () => ({ ForbiddenError: h.FakeForbidden, getPermissionSummary: (u: string) => h.getPermissionSummary(u) }));
vi.mock("@/modules/workflows/services/tasks", () => ({
  getTaskList: (...a: unknown[]) => (h.getTaskList as (...args: unknown[]) => unknown)(...a),
  getTaskDetailView: (...a: unknown[]) => (h.getTaskDetailView as (...args: unknown[]) => unknown)(...a),
}));
vi.mock("@/modules/workflows/services/lifecycle", () => ({
  createTask: (...a: unknown[]) => (h.createTask as (...args: unknown[]) => unknown)(...a),
  cancelTask: (...a: unknown[]) => (h.cancelTask as (...args: unknown[]) => unknown)(...a),
}));
vi.mock("@/modules/workflows/services/mail", () => ({
  retryDelivery: (...a: unknown[]) => (h.retryDelivery as (...args: unknown[]) => unknown)(...a),
  resolveDelivery: (...a: unknown[]) => (h.resolveDelivery as (...args: unknown[]) => unknown)(...a),
}));

import { ConflictError } from "@/modules/workflows/types";
import { GET as listGET, POST as createPOST } from "@/app/api/workflows/route";
import { GET as detailGET } from "@/app/api/workflows/[id]/route";
import { POST as cancelPOST } from "@/app/api/workflows/[id]/cancel/route";
import { POST as retryPOST } from "@/app/api/workflows/[id]/mail/[deliveryId]/retry/route";
import { POST as resolvePOST } from "@/app/api/workflows/[id]/mail/[deliveryId]/resolve/route";

const req = (url: string, body?: unknown) =>
  new Request(`http://t${url}`, body !== undefined ? { method: "POST", body: JSON.stringify(body) } : undefined);
const P = <T>(v: T) => Promise.resolve(v);

beforeEach(() => {
  h.setSession({ user: { id: "u1", systemRole: "MEMBER", email: "u1@x", name: "U1", employmentType: "REGULAR", jobFunction: "PM" } });
  for (const k of ["getPermissionSummary", "getTaskList", "getTaskDetailView", "createTask", "cancelTask", "retryDelivery", "resolveDelivery"] as const) (h[k] as any).mockClear();
  h.getPermissionSummary.mockResolvedValue({ keys: ["workflows.weekly:view", "workflows.weekly:create", "workflows.weekly:send"], isOwner: false, isAdmin: false });
});

describe("GET /api/workflows", () => {
  it("미인증 → 401", async () => {
    h.setSession(null);
    expect((await listGET(req("/api/workflows"))).status).toBe(401);
  });
  it("성공 → 200, getTaskList에 permissionKeys 전달", async () => {
    h.getTaskList.mockResolvedValue([{ id: "t1", kind: "WEEKLY_REPORT", typeName: "주간보고", scheduledAt: "2026-06-12T00:00:00.000Z", status: "PENDING" }]);
    const res = await listGET(req("/api/workflows"));
    expect(res.status).toBe(200);
    const ctxArg = (h.getTaskList.mock.calls[0] as unknown as [{ permissionKeys: Set<string> }])[0];
    expect(ctxArg.permissionKeys.has("workflows.weekly:view")).toBe(true);
  });
  it("잘못된 status → 400", async () => {
    expect((await listGET(req("/api/workflows?status=NOPE"))).status).toBe(400);
  });
});

describe("POST /api/workflows", () => {
  it("잘못된 입력(kind 누락) → 400", async () => {
    expect((await createPOST(req("/api/workflows", { scheduledAt: "2026-06-20T00:00:00.000Z" }))).status).toBe(400);
  });
  it("잘못된 kind enum → 400", async () => {
    expect((await createPOST(req("/api/workflows", { kind: "NOPE", scheduledAt: "2026-06-20T00:00:00.000Z" }))).status).toBe(400);
  });
  it("summary.isOwner=true면 ctx.isOwner=true로 createTask 호출, 201 (권위는 getPermissionSummary)", async () => {
    h.getPermissionSummary.mockResolvedValue({ keys: [], isOwner: true, isAdmin: true });
    h.setSession({ user: { id: "u1", systemRole: "OWNER", email: "o@x", name: "O", employmentType: "REGULAR", jobFunction: "PM" } });
    const res = await createPOST(req("/api/workflows", { kind: "BILLING", scheduledAt: "2026-06-20T00:00:00.000Z" }));
    expect(res.status).toBe(201);
    const ctxArg = (h.createTask.mock.calls[0] as unknown as [unknown, { isOwner: boolean }])[1];
    expect(ctxArg.isOwner).toBe(true);
  });
  it("must-change OWNER(summary.isOwner=false)면 session.systemRole=OWNER여도 ctx.isOwner=false — D17 우회 차단", async () => {
    h.getPermissionSummary.mockResolvedValue({ keys: [], isOwner: false, isAdmin: false });
    h.setSession({ user: { id: "u1", systemRole: "OWNER", email: "o@x", name: "O", employmentType: "REGULAR", jobFunction: "PM" } });
    const res = await createPOST(req("/api/workflows", { kind: "BILLING", scheduledAt: "2026-06-20T00:00:00.000Z" }));
    expect(res.status).toBe(201);
    const ctxArg = (h.createTask.mock.calls[0] as unknown as [unknown, { isOwner: boolean }])[1];
    expect(ctxArg.isOwner).toBe(false);
  });
  it("createTask ForbiddenError → 403", async () => {
    h.createTask.mockRejectedValue(new h.FakeForbidden("denied"));
    expect((await createPOST(req("/api/workflows", { kind: "BILLING", scheduledAt: "2026-06-20T00:00:00.000Z" }))).status).toBe(403);
  });
});

describe("GET /api/workflows/[id]", () => {
  it("null → 404", async () => {
    h.getTaskDetailView.mockResolvedValue(null);
    expect((await detailGET(req("/api/workflows/t1"), { params: P({ id: "t1" }) })).status).toBe(404);
  });
  it("권한 없음(ForbiddenError) → 403", async () => {
    h.getTaskDetailView.mockRejectedValue(new h.FakeForbidden());
    expect((await detailGET(req("/api/workflows/t1"), { params: P({ id: "t1" }) })).status).toBe(403);
  });
  it("성공 → 200", async () => {
    h.getTaskDetailView.mockResolvedValue({ id: "t1", kind: "WEEKLY_REPORT", typeName: "주간보고", scheduledAt: "x", status: "PENDING", files: [], mailDeliveries: [], timeline: [] });
    expect((await detailGET(req("/api/workflows/t1"), { params: P({ id: "t1" }) })).status).toBe(200);
  });
});

describe("POST cancel", () => {
  it("성공 → 200", async () => {
    expect((await cancelPOST(req("/api/workflows/t1/cancel"), { params: P({ id: "t1" }) })).status).toBe(200);
    expect(h.cancelTask).toHaveBeenCalled();
  });
  it("ConflictError → 409", async () => {
    h.cancelTask.mockRejectedValue(new ConflictError());
    expect((await cancelPOST(req("/api/workflows/t1/cancel"), { params: P({ id: "t1" }) })).status).toBe(409);
  });
});

describe("POST mail retry", () => {
  it("성공 → 200", async () => {
    const res = await retryPOST(req("/api/workflows/t1/mail/d1/retry"), { params: P({ id: "t1", deliveryId: "d1" }) });
    expect(res.status).toBe(200);
    const ctxArg = (h.retryDelivery.mock.calls[0] as unknown as [unknown, { isAdmin: boolean }])[1];
    expect(h.retryDelivery).toHaveBeenCalledWith({ deliveryId: "d1", taskId: "t1" }, expect.objectContaining({ isAdmin: false }));
    expect(ctxArg.isAdmin).toBe(false);
  });
  it("SENDING(ConflictError) → 409", async () => {
    h.retryDelivery.mockRejectedValue(new ConflictError());
    expect((await retryPOST(req("/api/workflows/t1/mail/d1/retry"), { params: P({ id: "t1", deliveryId: "d1" }) })).status).toBe(409);
  });
});

describe("POST mail resolve", () => {
  it("잘못된 to → 400", async () => {
    expect((await resolvePOST(req("/api/workflows/t1/mail/d1/resolve", { to: "NOPE" }), { params: P({ id: "t1", deliveryId: "d1" }) })).status).toBe(400);
  });
  it("summary.isAdmin=true → isAdmin=true로 resolveDelivery 호출, 200 (권위는 getPermissionSummary)", async () => {
    h.getPermissionSummary.mockResolvedValue({ keys: [], isOwner: false, isAdmin: true });
    h.setSession({ user: { id: "a1", systemRole: "ADMIN", email: "a@x", name: "A", employmentType: "REGULAR", jobFunction: "PM" } });
    const res = await resolvePOST(req("/api/workflows/t1/mail/d1/resolve", { to: "FAILED" }), { params: P({ id: "t1", deliveryId: "d1" }) });
    expect(res.status).toBe(200);
    const ctxArg = (h.resolveDelivery.mock.calls[0] as unknown as [unknown, { isAdmin: boolean }])[1];
    expect(ctxArg.isAdmin).toBe(true);
  });
  it("must-change ADMIN(summary.isAdmin=false)면 session.systemRole=ADMIN여도 ctx.isAdmin=false — resolve 우회 차단", async () => {
    h.getPermissionSummary.mockResolvedValue({ keys: [], isOwner: false, isAdmin: false });
    h.setSession({ user: { id: "a1", systemRole: "ADMIN", email: "a@x", name: "A", employmentType: "REGULAR", jobFunction: "PM" } });
    const res = await resolvePOST(req("/api/workflows/t1/mail/d1/resolve", { to: "FAILED" }), { params: P({ id: "t1", deliveryId: "d1" }) });
    expect(res.status).toBe(200);
    const ctxArg = (h.resolveDelivery.mock.calls[0] as unknown as [unknown, { isAdmin: boolean }])[1];
    expect(ctxArg.isAdmin).toBe(false);
  });
  it("비-admin resolveDelivery ForbiddenError → 403", async () => {
    h.resolveDelivery.mockRejectedValue(new h.FakeForbidden());
    expect((await resolvePOST(req("/api/workflows/t1/mail/d1/resolve", { to: "SENT" }), { params: P({ id: "t1", deliveryId: "d1" }) })).status).toBe(403);
  });
});
