import "server-only";
import { prisma } from "@/lib/prisma";

export const GENERATION_LEASE_TTL_MS = 120_000; // 2분. HWPX 4종 zip은 보통 수초, 안전마진.

/**
 * CAS 점유: lease가 없거나 만료(lockedUntil < now)일 때만 1행. 반환 true=점유, false=타인 보유(409).
 * 단일 SQL 문이라 원자적 — 동시 2건도 Postgres 행 잠금으로 직렬화돼 하나만 affected=1.
 * lockedUntil은 Node UTC Date로 set하고 만료는 DB now()로 비교한다. 컬럼이 TIMESTAMPTZ(R7-1)라 둘 다
 * 절대 instant로 비교돼 DB 세션 TimeZone과 무관하다(비-UTC DB에서도 TTL 정확).
 */
export async function acquireGenerationLease(
  taskId: string,
  holder: string,
  ttlMs = GENERATION_LEASE_TTL_MS,
): Promise<boolean> {
  const lockedUntil = new Date(Date.now() + ttlMs);
  const affected = await prisma.$executeRaw`
    INSERT INTO workflows."GenerationLock" ("taskId", "holder", "lockedUntil", "createdAt", "updatedAt")
    VALUES (${taskId}, ${holder}, ${lockedUntil}, now(), now())
    ON CONFLICT ("taskId") DO UPDATE
      SET "holder" = EXCLUDED."holder", "lockedUntil" = EXCLUDED."lockedUntil", "updatedAt" = now()
      WHERE workflows."GenerationLock"."lockedUntil" < now()
  `;
  return affected === 1;
}

/**
 * holder 일치 시만 삭제(steal된 경우 내 holder가 아니므로 0행 — 남의 lease 보호).
 */
export async function releaseGenerationLease(taskId: string, holder: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM workflows."GenerationLock"
    WHERE "taskId" = ${taskId} AND "holder" = ${holder}
  `;
}

/**
 * 현재 lease holder가 나(holder)인지 검사(steal 감지). steal당하면 row의 holder가 바뀌거나(다른 요청이 점유)
 * release 후 row가 사라져 false. 만료-미steal 상태(holder는 나)면 true이나, promote 직전 cheap early-abort 용도이고
 * 최종 권위 가드는 commitGeneratedTransition의 FOR UPDATE holder 검사다(원자적).
 */
export async function holdsGenerationLease(taskId: string, holder: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ ok: number }>>`
    SELECT 1 AS ok FROM workflows."GenerationLock"
    WHERE "taskId" = ${taskId} AND "holder" = ${holder}
  `;
  return rows.length > 0;
}
