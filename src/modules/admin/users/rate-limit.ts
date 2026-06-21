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
// ⚠️ 배포 계약(필수): 이 첫-값 신뢰는 신뢰 가능한 ingress(reverse proxy)가 **client가 보낸 X-Forwarded-For를
//    제거하고 실제 클라이언트 IP로 덮어쓸 때만** 성립한다. ingress가 client XFF를 append/passthrough하면
//    공격자가 첫 값을 위조해 임의 per-IP 버킷을 골라 per-IP 통제를 우회할 수 있다(docs/architecture.md 배포 섹션).
//    단, per-IP는 defense-in-depth 계층일 뿐 — hard 경계(PENDING_UNVERIFIED_CAP 트랜잭션 내·per-email·쿨다운·
//    토큰 256bit 엔트로피·emailVerifyTokenHash 인덱스)는 IP에 의존하지 않아 XFF가 위조돼도 유지된다.
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

// per-email 재발송 쿨다운(finding F-B — same-ms 동등비교 우회 차단). 명시 결정 방식:
// ON CONFLICT DO UPDATE의 WHERE로 "쿨다운 경과 시에만 갱신"하고, RETURNING 행 유무로 허용/거부를 판정.
// · 신규(충돌 없음): INSERT → 행 반환 → 허용
// · 쿨다운 경과(WHERE true): UPDATE → 행 반환 → 허용
// · 쿨다운 내(WHERE false): UPDATE 미실행 → 무행 반환 → RateLimitError
// 충돌 경로에서 row-lock이 직렬화되므로 same-ms 동시 요청에서 둘째는 첫째가 방금 now로 갱신한
// windowStartedAt(> cooldownFloor)을 보게 되어 WHERE가 거짓 → 무행 반환 → 거부.
// `RETURNING 1 AS "allowed"`: 소문자 alias라 pg casing 문제 없음(finding G 해소 유지).
export async function enforceResendCooldown(email: string, now: Date = new Date()): Promise<void> {
  const scope = "resend:email";
  const cooldownFloor = new Date(now.getTime() - RESEND_COOLDOWN_MS);
  // 명시 결정(F-B): 동등 비교 대신 ON CONFLICT DO UPDATE의 WHERE로 "쿨다운 경과 시에만 갱신"하고,
  // RETURNING 행 유무로 허용/거부를 판정한다. 충돌 시 row-lock으로 직렬화되고, 둘째 요청은 첫째가
  // 방금 now로 갱신한 windowStartedAt(> cooldownFloor)을 보므로 WHERE가 거짓→미갱신→무행 반환→거부.
  const rows = await prisma.$queryRaw<{ allowed: number }[]>`
    INSERT INTO "kernel"."RateBucket" ("id", "scope", "key", "windowStartedAt", "count", "updatedAt")
    VALUES (gen_random_uuid(), ${scope}, ${email}, ${now}, 1, ${now})
    ON CONFLICT ("scope", "key") DO UPDATE SET
      "windowStartedAt" = ${now},
      "count" = "RateBucket"."count" + 1,
      "updatedAt" = ${now}
    WHERE "RateBucket"."windowStartedAt" <= ${cooldownFloor}
    RETURNING 1 AS "allowed"`;
  if (rows.length === 0) {
    throw new RateLimitError("재발송은 잠시 후 다시 시도해 주세요.");
  }
}
