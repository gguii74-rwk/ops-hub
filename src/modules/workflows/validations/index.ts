import { z } from "zod";
import type { WorkflowStatus } from "@prisma/client";

const STATUS_VALUES = ["PENDING", "GENERATED", "REVIEWED", "SENT", "HQ_REQUESTED", "FINAL_SENT", "CANCELLED"] as const;

// 작업 생성은 비결정적 typeId(seed별 billing/wf-billing) 대신 안정적 kind enum을 받는다(D12).
const WORKFLOW_KINDS = ["WEEKLY_REPORT", "BILLING", "NOTIFICATION_BILLING", "WEEKLY_REPORT_CLIENT", "MONTHLY_REPORT_CLIENT"] as const;
export const createTaskSchema = z.object({
  kind: z.enum(WORKFLOW_KINDS),
  scheduledAt: z.string().min(1), // ISO 또는 YYYY-MM-DD. Date 변환·유효성은 라우트에서.
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

// --- billing (대금청구) ---
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_MONTHLY = MAX_SAFE / 12n; // J4: 12회차 누계 monthlyAmount*12도 안전정수 내

export const billingConfigSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  projectName: z.string().min(1),
  contractNumber: z.string().min(1),
  contractAmount: z.coerce.bigint().positive().refine((v) => v <= MAX_SAFE, "계약금액이 너무 큽니다."),       // F3
  monthlyAmount: z.coerce.bigint().positive().refine((v) => v <= MAX_MONTHLY, "월 청구금액이 너무 큽니다."),  // J4
  contractAmountKor: z.string().min(1),
  monthlyAmountKor: z.string().min(1),
});
export const billingConfigUpdateSchema = billingConfigSchema.partial().omit({ year: true });
export const billingRoundDateUpdateSchema = z.object({ submitDate: z.string().datetime() });

export type BillingConfigData = z.infer<typeof billingConfigSchema>;             // 금액은 bigint
export type BillingConfigUpdateData = z.infer<typeof billingConfigUpdateSchema>;
export type BillingRoundDateUpdateData = z.infer<typeof billingRoundDateUpdateSchema>;
