import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다.");

export const createLeaveSchema = z.object({
  leaveType: z.enum(["ANNUAL", "HALF", "QUARTER"]),
  leaveSubType: z.enum(["MORNING", "AFTERNOON"]).nullish(),
  quarterStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  startDate: dateStr,
  endDate: dateStr,
  reason: z.string().max(1000).nullish(),
});

export const adminCreateLeaveSchema = createLeaveSchema.extend({
  userId: z.string().min(1),
  sendNotification: z.boolean().optional(),
});

export const updateLeaveSchema = z.object({
  leaveType: z.enum(["ANNUAL", "HALF", "QUARTER"]).optional(),
  leaveSubType: z.enum(["MORNING", "AFTERNOON"]).nullish(),
  quarterStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  startDate: dateStr.optional(),
  endDate: dateStr.optional(),
  reason: z.string().max(1000).nullish(),
  adminActionNote: z.string().max(500).nullish(),
});

export const rejectSchema = z.object({ rejectionReason: z.string().min(1).max(500) });
export const cancelSchema = z.object({ cancellationReason: z.string().max(500).nullish() });

export const upsertAllocationSchema = z.object({
  allocatedDays: z.number().min(0),
  carriedOverDays: z.number().min(0).default(0),
  carriedOverExpiryDate: dateStr.nullish(),
});

export const adjustAllocationSchema = z.object({
  changeDays: z.number().positive(), // 양수 크기. 부호는 changeType이 결정(ADD=+, DEDUCT=-)
  changeType: z.enum(["ADD", "DEDUCT"]),
  reason: z.string().min(1).max(200),
  reasonDetail: z.string().max(500).nullish(),
});
