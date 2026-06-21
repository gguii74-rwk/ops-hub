import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const db = { user: { findUnique: vi.fn() } };
  return { db };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { authConfig } from "@/lib/auth/config";
import { sessionCallback } from "@/lib/auth/session-callback";

// 콜백 핸들 추출. jwt는 edge-safe config(config.ts)에, session은 node 전용 모듈(session-callback.ts)에 있다.
const jwtCb = authConfig.callbacks!.jwt as unknown as (a: { token: Record<string, unknown>; user?: Record<string, unknown> }) => Promise<Record<string, unknown>> | Record<string, unknown>;
const sessionCb = sessionCallback as unknown as (a: { session: Record<string, unknown>; token: Record<string, unknown> }) => Promise<Record<string, unknown>> | Record<string, unknown>;

const ISSUED = Math.floor(new Date("2026-06-10T00:00:00Z").getTime() / 1000); // token.iat(초)
const baseToken = () => ({
  uid: "u1", name: "n", email: "e@x.com",
  systemRole: "MEMBER", employmentType: "REGULAR", jobFunction: "DEVELOPER",
  mustChange: false, status: "ACTIVE", iat: ISSUED,
});
// DB 권위 스냅샷(유효·ACTIVE). 콜백은 이 값으로 session.user를 fresh 재구성한다.
const dbActive = (over: Record<string, unknown> = {}) => ({
  status: "ACTIVE", passwordChangedAt: null, sessionInvalidatedAt: null, mustChangePassword: false,
  systemRole: "MEMBER", name: "n", email: "e@x.com", employmentType: "REGULAR", jobFunction: "DEVELOPER",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("edge 안전성 — Edge 미들웨어가 쓰는 authConfig는 DB 의존 session 콜백을 갖지 않는다", () => {
  it("authConfig.callbacks.session은 정의되지 않음(prisma는 node 전용 session-callback.ts로 분리)", () => {
    // config.ts가 session 콜백(prisma 의존)을 가지면 src/middleware.ts(Edge)가 PrismaClient를 번들해 깨진다.
    expect(authConfig.callbacks?.session).toBeUndefined();
  });
});

describe("jwt 콜백 — 로그인 시 클레임 저장", () => {
  it("user가 있으면 mustChange/status/식별 클레임을 토큰에 저장", async () => {
    const token = await jwtCb({
      token: {},
      user: { id: "u1", name: "n", email: "e@x.com", systemRole: "MEMBER", employmentType: "REGULAR", jobFunction: "DEVELOPER", mustChangePassword: true, status: "ACTIVE" },
    });
    expect(token.uid).toBe("u1");
    expect(token.mustChange).toBe(true);
    expect(token.status).toBe("ACTIVE");
  });
  it("user가 없으면(후속 호출) 토큰을 보존만 한다", async () => {
    const prev = baseToken();
    const token = await jwtCb({ token: { ...prev } });
    expect(token.uid).toBe("u1");
    expect(token.mustChange).toBe(false);
  });
});

describe("session 콜백 — DB 권위 재구성·재검증(세션 무효화)", () => {
  it("DB가 ACTIVE·무효화 시각 없음 → 세션 user 채움(현재 mustChangePassword 반영)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbActive());
    const session = await sessionCb({ session: {}, token: baseToken() });
    expect((session as { user?: { id: string } }).user?.id).toBe("u1");
    expect((session as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(false);
  });
  it("session.user.systemRole은 DB 권위값으로 재구성(stale JWT가 OWNER여도 DB가 MEMBER면 MEMBER)", async () => {
    // JWT는 강등 전 OWNER 스냅샷을 보유. DB는 강등 후 MEMBER. anti-escalation은 DB systemRole만 신뢰해야 한다(finding #1).
    h.db.user.findUnique.mockResolvedValue(dbActive({ systemRole: "MEMBER" }));
    const session = await sessionCb({ session: {}, token: { ...baseToken(), systemRole: "OWNER" } });
    expect((session as { user: { systemRole: string } }).user.systemRole).toBe("MEMBER");
  });
  it("name/email도 DB 권위값으로 재구성(stale JWT 식별정보 무시)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbActive({ name: "새이름", email: "fresh@x.com" }));
    const session = await sessionCb({ session: {}, token: { ...baseToken(), name: "옛이름", email: "stale@x.com" } });
    expect((session as { user: { name: string; email: string } }).user.name).toBe("새이름");
    expect((session as { user: { name: string; email: string } }).user.email).toBe("fresh@x.com");
  });
  it("DB status가 DISABLED면 세션 무효(user 미설정)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbActive({ status: "DISABLED" }));
    const session = await sessionCb({ session: {}, token: baseToken() });
    expect((session as { user?: unknown }).user).toBeUndefined();
  });
  it("무효 세션이면 prefilled session.user도 제거(들어온 user를 그대로 반환 금지 — finding #1)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbActive({ status: "DISABLED" }));
    // NextAuth가 이미 채워 넣은 user가 있어도 무효면 명시적으로 비워야 한다.
    const session = await sessionCb({ session: { user: { id: "u1", systemRole: "OWNER" } }, token: baseToken() });
    expect((session as { user?: unknown }).user).toBeUndefined();
  });
  it("passwordChangedAt이 token.iat 이후면 세션 무효(비번변경으로 타 세션 무효화)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbActive({ passwordChangedAt: new Date("2026-06-11T00:00:00Z") })); // iat(06-10) 이후
    const session = await sessionCb({ session: {}, token: baseToken() });
    expect((session as { user?: unknown }).user).toBeUndefined();
  });
  it("sessionInvalidatedAt이 token.iat 이후면 세션 무효(비활성화/재설정)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbActive({ sessionInvalidatedAt: new Date("2026-06-11T00:00:00Z") }));
    const session = await sessionCb({ session: {}, token: baseToken() });
    expect((session as { user?: unknown }).user).toBeUndefined();
  });
  it("무효화 시각이 token.iat 이전이면 유효(세션 유지)", async () => {
    // iat(06-10) 이전 → 이 세션이 더 최신. 강제변경 필요 상태도 세션은 살아 있음(게이트가 따로 막음).
    h.db.user.findUnique.mockResolvedValue(dbActive({ passwordChangedAt: new Date("2026-06-09T00:00:00Z"), mustChangePassword: true }));
    const session = await sessionCb({ session: {}, token: baseToken() });
    expect((session as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(true);
  });
  it("DB에 사용자가 없으면 세션 무효", async () => {
    h.db.user.findUnique.mockResolvedValue(null);
    const session = await sessionCb({ session: {}, token: baseToken() });
    expect((session as { user?: unknown }).user).toBeUndefined();
  });
});
