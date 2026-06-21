import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() } },
  changePasswordTx: vi.fn(),
  authMock: vi.fn(),
  compare: vi.fn(),
  hash: vi.fn(),
  enforceRateLimit: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => h.authMock(...a) }));
vi.mock("@/modules/admin/users/repositories", () => ({ changePasswordTx: (...a: unknown[]) => h.changePasswordTx(...a) }));
vi.mock("bcryptjs", () => ({ default: { compare: (...a: unknown[]) => h.compare(...a), hash: (...a: unknown[]) => h.hash(...a) } }));
vi.mock("@/modules/admin/users/rate-limit", () => ({
  enforceRateLimit: (...a: unknown[]) => h.enforceRateLimit(...a),
  CHANGE_PASSWORD_LIMIT: 10,
}));
vi.mock("@/modules/admin/users/errors", async () => {
  class RateLimitError extends Error { constructor(msg: string) { super(msg); this.name = "RateLimitError"; } }
  class UserConflictError extends Error { constructor(msg: string) { super(msg); this.name = "UserConflictError"; } }
  return { RateLimitError, UserConflictError };
});

import { POST } from "@/app/api/auth/change-password/route";

const req = (body: unknown) => new Request("http://localhost/api/auth/change-password", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  h.hash.mockResolvedValue("newhash");
  h.changePasswordTx.mockResolvedValue(undefined);
  h.enforceRateLimit.mockResolvedValue(undefined); // 기본: 한도 이내
});

describe("POST /api/auth/change-password", () => {
  it("미인증이면 401, changePasswordTx 미호출", async () => {
    h.authMock.mockResolvedValue(null);
    const res = await POST(req({ currentPassword: "oldpassword12", newPassword: "newpassword12" }));
    expect(res.status).toBe(401);
    expect(h.changePasswordTx).not.toHaveBeenCalled();
  });
  it("newPassword 12자 미만이면 400", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: false } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "oldhash", mustChangePassword: false });
    const res = await POST(req({ currentPassword: "oldpassword12", newPassword: "short" }));
    expect(res.status).toBe(400);
    expect(h.changePasswordTx).not.toHaveBeenCalled();
  });
  it("자발 변경: 현재 비번 일치 → changePasswordTx(해시·now) 호출·200", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: false } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "oldhash", mustChangePassword: false });
    h.compare.mockResolvedValue(true);
    const res = await POST(req({ currentPassword: "oldpassword12", newPassword: "newpassword12" }));
    expect(res.status).toBe(200);
    expect(h.compare).toHaveBeenCalledWith("oldpassword12", "oldhash");
    expect(h.changePasswordTx).toHaveBeenCalledWith("u1", "newhash", expect.any(Date), "oldhash"); // finding 4: 현재 해시 CAS
  });
  it("자발 변경: 현재 비번 불일치 → 400, changePasswordTx 미호출", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: false } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "oldhash", mustChangePassword: false });
    h.compare.mockResolvedValue(false);
    const res = await POST(req({ currentPassword: "wrongpass1234", newPassword: "newpassword12" }));
    expect(res.status).toBe(400);
    expect(h.changePasswordTx).not.toHaveBeenCalled();
  });
  it("자발 변경: currentPassword 누락이면 400(자발은 현재 비번 필수)", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: false } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "oldhash", mustChangePassword: false });
    const res = await POST(req({ newPassword: "newpassword12" }));
    expect(res.status).toBe(400);
    expect(h.changePasswordTx).not.toHaveBeenCalled();
  });
  it("강제 변경: must-change 사용자는 현재(임시) 비번 일치 시 변경·플래그 해제(changePasswordTx)", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: true } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "temphash", mustChangePassword: true });
    h.compare.mockResolvedValue(true);
    const res = await POST(req({ currentPassword: "temppassword1", newPassword: "newpassword12" }));
    expect(res.status).toBe(200);
    expect(h.compare).toHaveBeenCalledWith("temppassword1", "temphash");
    expect(h.changePasswordTx).toHaveBeenCalledWith("u1", "newhash", expect.any(Date), "temphash"); // finding 4: 현재 해시 CAS
  });
  it("강제 변경: 새 비번이 현재(임시) 비번과 같으면 400 — 임시 비번 재사용 우회 차단(changePasswordTx 미호출)", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: true } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "temphash", mustChangePassword: true });
    h.compare.mockResolvedValue(true); // 현재(임시) 비번은 일치하지만
    const res = await POST(req({ currentPassword: "temppassword1", newPassword: "temppassword1" }));
    expect(res.status).toBe(400);
    expect(h.changePasswordTx).not.toHaveBeenCalled(); // 플래그 해제·영구화 차단
  });
  it("자발 변경: 새 비번이 현재 비번과 같으면 400(재사용 금지)", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: false } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "oldhash", mustChangePassword: false });
    h.compare.mockResolvedValue(true);
    const res = await POST(req({ currentPassword: "samepass12345", newPassword: "samepass12345" }));
    expect(res.status).toBe(400);
    expect(h.changePasswordTx).not.toHaveBeenCalled();
  });
  it("강제 변경도 현재(임시) 비번 불일치면 400(fresh 로그인 외 우회 금지)", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: true } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "temphash", mustChangePassword: true });
    h.compare.mockResolvedValue(false);
    const res = await POST(req({ currentPassword: "wrong1234567", newPassword: "newpassword12" }));
    expect(res.status).toBe(400);
    expect(h.changePasswordTx).not.toHaveBeenCalled();
  });
  it("finding 4: 검증~쓰기 사이 admin reset로 CAS 충돌(changePasswordTx UserConflictError)이면 409", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: false } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "oldhash", mustChangePassword: false });
    h.compare.mockResolvedValue(true);
    const { UserConflictError } = await import("@/modules/admin/users/errors");
    h.changePasswordTx.mockRejectedValueOnce(new UserConflictError("처리 중 비밀번호가 변경되었습니다. 다시 로그인해 주세요."));
    const res = await POST(req({ currentPassword: "oldpassword12", newPassword: "newpassword12" }));
    expect(res.status).toBe(409);
  });
  it("레이트리밋 초과 → 429, bcrypt.compare 미호출", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: false } });
    const { RateLimitError } = await import("@/modules/admin/users/errors");
    h.enforceRateLimit.mockRejectedValueOnce(new RateLimitError("too many"));
    const res = await POST(req({ currentPassword: "oldpassword12", newPassword: "newpassword12" }));
    expect(res.status).toBe(429);
    expect(h.compare).not.toHaveBeenCalled();
    expect(h.changePasswordTx).not.toHaveBeenCalled();
  });
});
