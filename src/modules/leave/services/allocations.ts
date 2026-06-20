import "server-only";
import type {
  AllocationSummary,
  AdjustAllocationInput,
} from "../types";
import { parseLeaveDate } from "../rules";
import {
  findActiveAllocation,
  sumPendingDays,
  upsertAllocation as upsertAllocationRepo,
  adjustAllocationTx,
  recalculateUsedDaysTx,
  listAllocations as listAllocationsRepo,
  getAllocationHistory as getHistoryRepo,
} from "../repositories";

// 연차 요약. 할당 없으면 null(UI는 "미설정" 표시).
export async function getAllocationSummary(
  userId: string,
  year: number
): Promise<AllocationSummary | null> {
  const alloc = await findActiveAllocation(userId, year);
  if (!alloc) return null;
  const pendingDays = await sumPendingDays(userId, year);
  const allocatedDays = Number(alloc.allocatedDays);
  const carriedOverDays = Number(alloc.carriedOverDays);
  const usedDays = Number(alloc.usedDays);
  const totalDays = allocatedDays + carriedOverDays;
  return {
    year,
    allocatedDays,
    carriedOverDays,
    totalDays,
    usedDays,
    pendingDays,
    remainingDays: totalDays - usedDays - pendingDays,
    carriedOverExpiryDate: alloc.carriedOverExpiryDate ?? null,
  };
}

export function setAllocation(
  userId: string,
  year: number,
  input: {
    allocatedDays: number;
    carriedOverDays: number;
    carriedOverExpiryDate?: string | null;
  }
) {
  return upsertAllocationRepo(userId, year, {
    allocatedDays: input.allocatedDays,
    carriedOverDays: input.carriedOverDays,
    carriedOverExpiryDate: input.carriedOverExpiryDate
      ? parseLeaveDate(input.carriedOverExpiryDate)
      : null,
  });
}

export function adjustAllocation(
  input: AdjustAllocationInput,
  adminId: string
) {
  return adjustAllocationTx({
    userId: input.userId,
    year: input.year,
    changeDays: input.changeDays,
    changeType: input.changeType,
    reason: input.reason,
    reasonDetail: input.reasonDetail ?? null,
    adminId,
  });
}

export function recalculate(
  userId: string,
  year: number
): Promise<number> {
  return recalculateUsedDaysTx(userId, year);
}

export function listAllocations(year: number) {
  return listAllocationsRepo(year);
}

export function getAllocationHistory(userId: string, year?: number) {
  return getHistoryRepo(userId, year);
}
