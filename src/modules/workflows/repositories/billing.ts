import "server-only";
import { prisma, type PrismaTx } from "@/lib/prisma";
import type { BillingConfigData, BillingConfigUpdateData } from "../validations";

export interface BillingConfigRow {
  id: string; year: number; projectName: string; contractNumber: string;
  contractAmount: bigint; monthlyAmount: bigint; contractAmountKor: string; monthlyAmountKor: string;
  createdAt: Date; updatedAt: Date;
}
export interface BillingRoundDateRow { id: string; year: number; round: number; submitDate: Date; }

export async function findAllBillingConfig(): Promise<BillingConfigRow[]> {
  return prisma.billingConfig.findMany({ orderBy: { year: "desc" } });
}

export async function findBillingConfigByYear(year: number): Promise<BillingConfigRow | null> {
  return prisma.billingConfig.findUnique({ where: { year } });
}

export async function createBillingConfig(data: BillingConfigData): Promise<BillingConfigRow> {
  return prisma.billingConfig.create({ data });
}

export async function updateBillingConfigByYear(year: number, data: BillingConfigUpdateData): Promise<BillingConfigRow> {
  return prisma.billingConfig.update({ where: { year }, data });
}

// 회차 연쇄 삭제를 한 트랜잭션으로(day-sync는 순차 await였으나 ops-hub는 원자, spec §6.2).
export async function deleteBillingConfigByYear(year: number): Promise<void> {
  await prisma.$transaction(async (tx: PrismaTx) => {
    await tx.billingRoundDate.deleteMany({ where: { year } });
    await tx.billingConfig.delete({ where: { year } });
  });
}

export async function findRoundDatesByYear(year: number): Promise<BillingRoundDateRow[]> {
  return prisma.billingRoundDate.findMany({
    where: { year }, orderBy: { round: "asc" },
    select: { id: true, year: true, round: true, submitDate: true },
  });
}

export async function findRoundDate(year: number, round: number): Promise<BillingRoundDateRow | null> {
  return prisma.billingRoundDate.findUnique({
    where: { year_round: { year, round } },
    select: { id: true, year: true, round: true, submitDate: true },
  });
}

export async function upsertRoundDate(year: number, round: number, submitDate: Date): Promise<BillingRoundDateRow> {
  return prisma.billingRoundDate.upsert({
    where: { year_round: { year, round } },
    update: { submitDate },
    create: { year, round, submitDate },
    select: { id: true, year: true, round: true, submitDate: true },
  });
}

export async function deleteRoundDate(year: number, round: number): Promise<void> {
  await prisma.billingRoundDate.delete({ where: { year_round: { year, round } } });
}
