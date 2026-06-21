import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const db = {
    $queryRaw: vi.fn(),          // ON CONFLICT … RETURNING (단일 atomic upsert)
  };
  const prisma = { ...db, $transaction: vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db)) };
  return { db, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { extractClientIp, enforceRateLimit, enforceResendCooldown, SIGNUP_IP_LIMIT, SIGNUP_EMAIL_LIMIT, RESEND_COOLDOWN_MS } from "@/modules/admin/users/rate-limit";
import { RateLimitError } from "@/modules/admin/users/errors";

beforeEach(() => vi.clearAllMocks());

describe("extractClientIp", () => {
  it("x-forwarded-for의 첫 IP(클라이언트)를 쓴다(프록시 체인 trim)", () => {
    const req = new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
    expect(extractClientIp(req)).toBe("203.0.113.7");
  });
  it("헤더 없으면 'unknown'(차단 안 함·공유 버킷)", () => {
    expect(extractClientIp(new Request("http://x/"))).toBe("unknown");
  });
});

describe("enforceRateLimit (race-safe — 단일 atomic upsert + RETURNING count)", () => {
  const now = new Date("2026-06-21T00:00:00Z");
  it("단일 atomic upsert를 실행하고 RETURNING count로 판정(별도 read 없음)", async () => {
    // 윈도우 내면 count+1, 만료/신규면 count=1 — 한 문장이 반환한 count<=limit이면 통과.
    h.db.$queryRaw.mockResolvedValue([{ count: 2 }]);
    await expect(enforceRateLimit("signup:email", "a@x.com", SIGNUP_EMAIL_LIMIT, now)).resolves.toBeUndefined();
    // read/decide-then-write 금지: findUnique/updateMany/upsert(client API)가 아니라 raw upsert 한 번만.
    expect(h.db.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it("증가 후 count가 limit 초과면 RateLimitError(429)", async () => {
    h.db.$queryRaw.mockResolvedValue([{ count: SIGNUP_EMAIL_LIMIT + 1 }]);
    await expect(enforceRateLimit("signup:email", "a@x.com", SIGNUP_EMAIL_LIMIT, now)).rejects.toBeInstanceOf(RateLimitError);
  });
  it("신규/막만료: 같은 문장이 count=1로 리셋해 반환 → limit>=1이면 통과(첫 시도가 곧바로 막히지 않음)", async () => {
    // 만료/부재 분기도 동일 upsert가 처리(별도 lock+reset 단계 없음 — lock-전-판정 race 제거).
    h.db.$queryRaw.mockResolvedValue([{ count: 1 }]);
    await expect(enforceRateLimit("signup:ip", "203.0.113.7", SIGNUP_IP_LIMIT, now)).resolves.toBeUndefined();
    expect(h.db.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it("count===limit(경계)는 통과(> limit에서만 거부)", async () => {
    h.db.$queryRaw.mockResolvedValue([{ count: SIGNUP_EMAIL_LIMIT }]);
    await expect(enforceRateLimit("signup:email", "edge@x.com", SIGNUP_EMAIL_LIMIT, now)).resolves.toBeUndefined();
  });
});

describe("enforceResendCooldown (per-email 쿨다운 — 단일 atomic upsert + RETURNING)", () => {
  const now = new Date("2026-06-21T00:00:00Z");
  it("쿨다운 경과면 windowStartedAt을 now로 갱신·통과(반환 windowStartedAt===now)", async () => {
    // 쿨다운 경과 시에만 now로 set하는 조건부 upsert가 now를 돌려줌 → 발송 허용.
    h.db.$queryRaw.mockResolvedValue([{ windowstartedat: now }]);
    await expect(enforceResendCooldown("a@x.com", now)).resolves.toBeUndefined();
    expect(h.db.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it("첫 발송(버킷 없음): 같은 문장이 now로 insert → 통과", async () => {
    h.db.$queryRaw.mockResolvedValue([{ windowstartedat: now }]);
    await expect(enforceResendCooldown("a@x.com", now)).resolves.toBeUndefined();
  });
  it("쿨다운 내 재발송이면 갱신 거부(반환 windowStartedAt이 직전값) → RateLimitError", async () => {
    const last = new Date(now.getTime() - 1000); // 쿨다운(60s) 이내
    h.db.$queryRaw.mockResolvedValue([{ windowstartedat: last }]);
    await expect(enforceResendCooldown("a@x.com", now)).rejects.toBeInstanceOf(RateLimitError);
  });
});
