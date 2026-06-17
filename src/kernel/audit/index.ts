import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PrismaTx } from "@/lib/prisma";

export interface AuditInput {
  actorId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}

/**
 * 감사 로그 1건 기록. 트랜잭션 안에서 쓰려면 `tx`를, 아니면 전역 `prisma`를 넘긴다.
 * (PrismaClient는 구조적으로 PrismaTx에 대입 가능하므로 둘 다 받는다.)
 */
export async function writeAudit(client: PrismaTx, input: AuditInput): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      metadata: (input.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    },
  });
}

export { prisma as auditClient };
