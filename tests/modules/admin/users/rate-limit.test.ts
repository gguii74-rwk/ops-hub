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

describe("enforceResendCooldown (per-email 쿨다운 — 명시 결정: WHERE+RETURNING 행 유무, F-B)", () => {
  const now = new Date("2026-06-21T00:00:00Z");
  it("쿨다운 경과면 갱신·통과: $queryRaw가 행을 반환하면 resolves", async () => {
    // ON CONFLICT WHERE true → UPDATE 실행 → RETURNING 1 행 → 허용.
    h.db.$queryRaw.mockResolvedValue([{ allowed: 1 }]);
    await expect(enforceResendCooldown("a@x.com", now)).resolves.toBeUndefined();
    expect(h.db.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it("첫 발송(버킷 없음): INSERT 행 반환 → 통과", async () => {
    // 충돌 없는 INSERT 경로도 RETURNING이 행을 돌려줌 → 허용.
    h.db.$queryRaw.mockResolvedValue([{ allowed: 1 }]);
    await expect(enforceResendCooldown("new@x.com", now)).resolves.toBeUndefined();
  });
  it("쿨다운 내 재발송: WHERE 미충족 → 무행 반환 → RateLimitError", async () => {
    // ON CONFLICT WHERE false → UPDATE 미실행 → RETURNING 없음 → 거부.
    h.db.$queryRaw.mockResolvedValue([]);
    await expect(enforceResendCooldown("a@x.com", now)).rejects.toBeInstanceOf(RateLimitError);
  });
  it("same-ms 동시 재발송: 둘째는 갱신 거부([] 반환) → RateLimitError (동등비교 우회 제거 회귀)", async () => {
    // F-B 회귀 검증: 동등 비교 방식은 둘 다 통과했으나, WHERE+행유무 방식은 무행 반환이면 무조건 거부.
    // 둘째 동시 요청이 SQL에서 [] 반환하는 상황을 재현.
    h.db.$queryRaw.mockResolvedValue([]);
    await expect(enforceResendCooldown("a@x.com", now)).rejects.toBeInstanceOf(RateLimitError);
  });
});
