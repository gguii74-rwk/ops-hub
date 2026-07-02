import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<unknown> => ({ user: { id: "u1", systemRole: "MEMBER" } })),
  getPermissionSummary: vi.fn(async () => ({ keys: ["workflows.billing:send"] as string[], isOwner: false, isAdmin: false })),
  runSend: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/kernel/access", () => ({
  ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } },
  getPermissionSummary: (...a: unknown[]) => (h.getPermissionSummary as (...args: unknown[]) => unknown)(...a),
}));
vi.mock("@/modules/workflows/services/send", () => ({
  runSend: (...a: unknown[]) => (h.runSend as (...args: unknown[]) => unknown)(...a),
}));

import { POST } from "@/app/api/workflows/[id]/send/route";

const req = (body: unknown) => new Request("http://t/api/workflows/t1/send", { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "t1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", systemRole: "MEMBER" } });
  h.getPermissionSummary.mockResolvedValue({ keys: ["workflows.billing:send"], isOwner: false, isAdmin: false });
  h.runSend.mockResolvedValue(undefined);
});

describe("POST /api/workflows/[id]/send — cc/bcc 스키마", () => {
  it("미인증 401", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await POST(req({ step: 1, subject: "s", body: "b" }), params)).status).toBe(401);
  });
  it("cc/bcc 포함 입력을 runSend에 그대로 전달 → 200", async () => {
    const res = await POST(req({ step: 1, subject: "s", body: "b", recipients: ["a@x.com"], cc: ["c@x.com"], bcc: ["d@x.com"] }), params);
    expect(res.status).toBe(200);
    const [, input] = h.runSend.mock.calls[0] as unknown as [string, { cc?: string[]; bcc?: string[] }];
    expect(input.cc).toEqual(["c@x.com"]);
    expect(input.bcc).toEqual(["d@x.com"]);
  });
  it("cc/bcc 생략 허용(기존 계약 회귀)", async () => {
    expect((await POST(req({ step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }), params)).status).toBe(200);
  });
  it("cc에 비이메일 → 400", async () => {
    const res = await POST(req({ step: 1, subject: "s", body: "b", recipients: ["a@x.com"], cc: ["nope"] }), params);
    expect(res.status).toBe(400);
    expect(h.runSend).not.toHaveBeenCalled();
  });
  it("bcc에 비이메일 → 400", async () => {
    expect((await POST(req({ step: 1, subject: "s", body: "b", recipients: ["a@x.com"], bcc: ["nope"] }), params)).status).toBe(400);
  });
});
