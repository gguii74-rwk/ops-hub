import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTx } from "@/lib/prisma";
import { SettingConcurrencyError } from "./registry";

export interface SettingRow {
  value: unknown;
  updatedAt: Date;
}

export async function readRaw(key: string): Promise<SettingRow | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? { value: row.value, updatedAt: row.updatedAt } : null;
}

export interface WriteParams {
  key: string;
  value: Prisma.InputJsonValue;
  expectedUpdatedAt?: Date | null;
  actorId: string;
  redact: (before: unknown | undefined, after: unknown) => Prisma.InputJsonValue;
}

export async function writeWithAudit(p: WriteParams): Promise<{ updatedAt: Date }> {
  return prisma.$transaction(async (tx: PrismaTx) => {
    const prior = await tx.systemSetting.findUnique({ where: { key: p.key } });
    const before = prior?.value;

    let updatedAt: Date;
    if (p.expectedUpdatedAt === null) {
      try {
        const created = await tx.systemSetting.create({ data: { key: p.key, value: p.value } });
        updatedAt = created.updatedAt;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new SettingConcurrencyError(p.key);
        }
        throw e;
      }
    } else if (p.expectedUpdatedAt instanceof Date) {
      const res = await tx.systemSetting.updateMany({
        where: { key: p.key, updatedAt: p.expectedUpdatedAt },
        data: { value: p.value },
      });
      if (res.count === 0) throw new SettingConcurrencyError(p.key);
      const row = await tx.systemSetting.findUniqueOrThrow({ where: { key: p.key } });
      updatedAt = row.updatedAt;
    } else {
      const row = await tx.systemSetting.upsert({
        where: { key: p.key },
        create: { key: p.key, value: p.value },
        update: { value: p.value },
      });
      updatedAt = row.updatedAt;
    }

    await tx.auditLog.create({
      data: {
        actorId: p.actorId,
        entityType: "SystemSetting",
        entityId: p.key,
        action: "settings.update",
        metadata: p.redact(before, p.value),
      },
    });

    return { updatedAt };
  });
}
