import { describe, it, expect, vi, beforeEach } from "vitest";

// session 콜백을 실제 session-callback.ts에서 가져와 호출(prisma만 모킹). NextAuth 부트스트랩 없이 콜백 단위 호출.
// 본 테스트의 범위: "권위는 DB"라는 불변식의 경계 통합 — 콜백 내부 분기 전수는 task-07(session-invalidation.test.ts)이 검증한다.
//
// Drift 2 해소: authConfig.callbacks.session은 undefined(Edge-safe 설계, config.ts에 주석으로 명시).
// sessionCallback은 session-callback.ts에 직접 export됨. 같은 패턴을 session-invalidation.test.ts가 이미 사용한다.
const h = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { sessionCallback } from "@/lib/auth/session-callback";

// sessionCallback의 타입: NextAuthConfig["callbacks"]["session"].
// 테스트에서는 {session, token} → session 형태로 단위 호출한다.
const sessionCb = sessionCallback as unknown as (
  a: { session: Record<string, unknown>; token: Record<string, unknown> },
) => Promise<Record<string, unknown>> | Record<string, unknown>;

const ISSUED = Math.floor(new Date("2026-06-10T00:00:00Z").getTime() / 1000); // token.iat(초)
// 강등 전 OWNER 스냅샷을 든 stale JWT(발급 시점엔 OWNER였음).
const staleOwnerToken = () => ({
  uid: "u1", name: "n", email: "e@x.com",
  systemRole: "OWNER", employmentType: "REGULAR", jobFunction: "DEVELOPER",
  mustChange: false, status: "ACTIVE", iat: ISSUED,
});
// 유효·ACTIVE DB 스냅샷(권위). over로 권위 필드를 덮어쓴다.
const dbSnap = (over: Record<string, unknown> = {}) => ({
  status: "ACTIVE", passwordChangedAt: null, sessionInvalidatedAt: null, mustChangePassword: false,
  systemRole: "MEMBER", name: "n", email: "e@x.com", employmentType: "REGULAR", jobFunction: "DEVELOPER",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("session 권위 — session.user.systemRole은 stale JWT가 아니라 DB systemRole로 재구성(finding #1)", () => {
  it("stale JWT systemRole=OWNER인데 DB=MEMBER면 session.user.systemRole은 MEMBER(not-owner)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbSnap({ systemRole: "MEMBER" }));
    const session = await sessionCb({ session: {}, token: staleOwnerToken() });
    const role = (session as { user: { systemRole: string } }).user.systemRole;
    expect(role).toBe("MEMBER");
    // 세션 콜백이 DB로 재구성하므로 UI/식별 소비자는 강등을 즉시 본다. (finding 3 이후 ActorContext.isOwner는
    // session.user.systemRole이 아니라 getPermissionSummary().isOwner에서 오므로 actor 권위는 task-07 게이트가 별도 보장.)
    expect(role === "OWNER").toBe(false);
  });

  it("DB가 실제 OWNER면 session.user.systemRole=OWNER(권위 일치 시 정상 통과)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbSnap({ systemRole: "OWNER" }));
    const session = await sessionCb({ session: {}, token: staleOwnerToken() });
    expect((session as { user: { systemRole: string } }).user.systemRole).toBe("OWNER");
  });

  it("무효 세션(DB DISABLED)이면 session.user가 제거된다(권위 부재 → 인가 불가)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbSnap({ status: "DISABLED" }));
    // NextAuth가 prefill한 user(OWNER)가 있어도 무효면 새어 나가면 안 된다.
    const session = await sessionCb({
      session: { user: { id: "u1", systemRole: "OWNER" } },
      token: staleOwnerToken(),
    });
    expect((session as { user?: unknown }).user).toBeUndefined();
  });
});
