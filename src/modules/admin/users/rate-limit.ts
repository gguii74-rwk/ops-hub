import "server-only";
import { prisma } from "@/lib/prisma";
import { RateLimitError } from "./errors";

// ── S10 공유 상수 (D16 토큰 만료 + D18 레이트리밋) ──
export const VERIFY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일 — set-password 겸 검증 토큰 만료(D16)
export const SIGNUP_IP_LIMIT = 10;            // per-IP 윈도우당 가입 시도
export const SIGNUP_EMAIL_LIMIT = 3;          // per-email 윈도우당 가입 시도
export const RESEND_COOLDOWN_MS = 60 * 1000;  // 재발송 쿨다운(per-email)
export const RATE_WINDOW_MS = 60 * 60 * 1000; // 레이트 윈도우 1시간
export const PENDING_UNVERIFIED_CAP = 200;    // 미처리 미검증 PENDING 전역 상한(bounded creation — task-03 createPendingSignup에서 트랜잭션 내 강제)
export const CHANGE_PASSWORD_LIMIT = 10;      // per-user 비번변경 시도 윈도우 상한(온라인 추측·bcrypt DoS 방지)

// IP는 x-forwarded-for의 첫 항목(클라이언트). 서버가 망 제한 뒤라 신뢰 가능(D1). 헤더 없으면 공유 'unknown' 버킷.
export function extractClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return "unknown";
  const first = xff.split(",")[0]?.trim();
  return first || "unknown";
}

// 원자적·사전·race-safe 카운터(finding A — lock-전-판정 race 제거).
// 단일 INSERT … ON CONFLICT … DO UPDATE 한 문장이 분기를 모두 처리한다:
//   · 윈도우 내(windowStartedAt > now-window): count+1, windowStartedAt 유지
//   · 만료/신규: count=1, windowStartedAt=now (새 윈도우 시작)
// RETURNING count로 post-update count를 받아 > limit이면 거부. read/decide-then-write가 없어
// 동시 첫-윈도우/막만료 요청도 한 행에 직렬화(같은 행을 UPDATE하므로 row lock)되어 reset이 덮어쓰지 않는다.
// multiSchema: 테이블은 "kernel"."RateBucket"로 스키마 한정(S1 @@schema("kernel")).
export async function enforceRateLimit(
  scope: string,
  key: string,
  limit: number,
  now: Date = new Date(),
): Promise<void> {
  const windowFloor = new Date(now.getTime() - RATE_WINDOW_MS);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "kernel"."RateBucket" ("id", "scope", "key", "windowStartedAt", "count", "updatedAt")
    VALUES (gen_random_uuid(), ${scope}, ${key}, ${now}, 1, ${now})
    ON CONFLICT ("scope", "key") DO UPDATE SET
      "count" = CASE WHEN "RateBucket"."windowStartedAt" > ${windowFloor}
                     THEN "RateBucket"."count" + 1 ELSE 1 END,
      "windowStartedAt" = CASE WHEN "RateBucket"."windowStartedAt" > ${windowFloor}
                               THEN "RateBucket"."windowStartedAt" ELSE ${now} END,
      "updatedAt" = ${now}
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 1);
  if (count > limit) throw new RateLimitError("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
}

// per-email 재발송 쿨다운(finding A — read-then-write 제거). 단일 atomic upsert:
// windowStartedAt을 마지막 발송 시각으로 쓰고, 쿨다운(RESEND_COOLDOWN_MS)이 경과했을 때만 now로 갱신.
// RETURNING windowStartedAt == now면 우리가 갱신한 것(발송 허용), 직전 값이면 쿨다운 내(거부).
// finding G(casing): pg는 `RETURNING "windowStartedAt"`을 camelCase 키로 노출하는데(quoted 식별자
// 보존), 코드가 소문자 `rows[0].windowstartedat`를 읽으면 항상 undefined → last가 undefined가 되어
// 첫 발송 포함 모든 resend가 RateLimitError로 거부된다. 키 불일치를 없애기 위해 SQL에서
// `AS "windowstartedat"`로 **명시 alias**(반환 키를 소문자로 고정)하고 같은 소문자 키로 읽는다.
// (mock도 소문자 키로 맞춘다 — 소문자 mock이 camelCase 프로덕션 실패를 숨기지 않게.)
export async function enforceResendCooldown(email: string, now: Date = new Date()): Promise<void> {
  const scope = "resend:email";
  const cooldownFloor = new Date(now.getTime() - RESEND_COOLDOWN_MS);
  const rows = await prisma.$queryRaw<{ windowstartedat: Date }[]>`
    INSERT INTO "kernel"."RateBucket" ("id", "scope", "key", "windowStartedAt", "count", "updatedAt")
    VALUES (gen_random_uuid(), ${scope}, ${email}, ${now}, 1, ${now})
    ON CONFLICT ("scope", "key") DO UPDATE SET
      "windowStartedAt" = CASE WHEN "RateBucket"."windowStartedAt" <= ${cooldownFloor}
                               THEN ${now} ELSE "RateBucket"."windowStartedAt" END,
      "count" = CASE WHEN "RateBucket"."windowStartedAt" <= ${cooldownFloor}
                     THEN "RateBucket"."count" + 1 ELSE "RateBucket"."count" END,
      "updatedAt" = ${now}
    RETURNING "windowStartedAt" AS "windowstartedat"`;
  const last = rows[0]?.windowstartedat;
  if (!last || last.getTime() !== now.getTime()) {
    throw new RateLimitError("재발송은 잠시 후 다시 시도해 주세요.");
  }
}
