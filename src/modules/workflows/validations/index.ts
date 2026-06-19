import { z } from "zod";
import type { WorkflowStatus } from "@prisma/client";

const STATUS_VALUES = ["PENDING", "GENERATED", "REVIEWED", "SENT", "HQ_REQUESTED", "FINAL_SENT", "CANCELLED"] as const;

export const createTaskSchema = z.object({
  typeId: z.string().min(1),
  scheduledAt: z.string().min(1), // ISO 문자열. Date 변환·유효성은 라우트에서.
});

export const resolveSchema = z.object({
  to: z.enum(["SENT", "FAILED"]),
});

// CSV status → WorkflowStatus[]. 하나라도 무효면 null(라우트 400).
export function parseStatusList(csv: string): WorkflowStatus[] | null {
  const parts = csv.split(",").map((s) => s.trim()).filter(Boolean);
  const valid = new Set<string>(STATUS_VALUES);
  if (parts.length === 0 || parts.some((p) => !valid.has(p))) return null;
  return parts as WorkflowStatus[];
}
