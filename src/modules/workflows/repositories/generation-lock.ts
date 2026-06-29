import "server-only";
import { prisma } from "@/lib/prisma";

export const GENERATION_LEASE_TTL_MS = 120_000; // 2분. HWPX 4종 zip은 보통 수초, 안전마진.

/**
 * CAS 점유: lease가 없거나 만료(lockedUntil < now)일 때만 1행. 반환 true=점유, false=타인 보유(409).
 * 단일 SQL 문이라 원자적 — 동시 2건도 Postgres 행 잠금으로 직렬화돼 하나만 affected=1.
 * expiry는 JS 클럭으로 계산(단일 서버, 2분 TTL이라 스큐 무시 가능). 만료 비교는 DB now()로.
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
