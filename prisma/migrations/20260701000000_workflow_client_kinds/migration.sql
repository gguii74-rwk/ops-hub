-- AlterEnum: additive(forward-safe). 기존 값·행 불변.
ALTER TYPE "workflows"."WorkflowKind" ADD VALUE 'WEEKLY_REPORT_CLIENT';
ALTER TYPE "workflows"."WorkflowKind" ADD VALUE 'MONTHLY_REPORT_CLIENT';
