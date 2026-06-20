import type { LeaveType, LeaveSubType } from "@prisma/client";

export interface CreateLeaveInput {
  leaveType: LeaveType;
  leaveSubType?: LeaveSubType | null;
  quarterStartTime?: string | null;
  startDate: string;
  endDate: string;
  reason?: string | null;
}

export interface AllocationSummary {
  year: number;
  allocatedDays: number;
  carriedOverDays: number;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
  carriedOverExpiryDate: Date | null;
}

export interface AdjustAllocationInput {
  userId: string;
  year: number;
  changeDays: number;
  changeType: "ADD" | "DEDUCT";
  reason: string;
  reasonDetail?: string | null;
}

export interface LeaveCtx {
  userId: string;
  isOwner: boolean;
  permissionKeys: Set<string>;
}
