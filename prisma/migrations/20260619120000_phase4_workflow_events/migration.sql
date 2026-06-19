-- CreateEnum
CREATE TYPE "workflows"."MailDeliveryStatus" AS ENUM ('SENDING', 'SENT', 'FAILED');

-- AlterTable: MailDelivery.status — 2단(임시 default로 추가 후 제거). 빈 테이블이라 backfill 불필요하나
-- 향후 행이 있어도 NOT NULL 추가가 안전하도록 임시 default를 거친 뒤 제거한다(§4.2).
ALTER TABLE "workflows"."MailDelivery" ADD COLUMN "status" "workflows"."MailDeliveryStatus" NOT NULL DEFAULT 'SENDING';
ALTER TABLE "workflows"."MailDelivery" ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable: MailDelivery 신규 컬럼 + sentAt nullable/no-default
ALTER TABLE "workflows"."MailDelivery" ADD COLUMN "bodyHtml" TEXT;
ALTER TABLE "workflows"."MailDelivery" ADD COLUMN "errorMessage" TEXT;
ALTER TABLE "workflows"."MailDelivery" ALTER COLUMN "sentAt" DROP NOT NULL;
ALTER TABLE "workflows"."MailDelivery" ALTER COLUMN "sentAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "workflows"."WorkflowTaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromStatus" "workflows"."WorkflowStatus",
    "toStatus" "workflows"."WorkflowStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowTaskEvent_taskId_occurredAt_idx" ON "workflows"."WorkflowTaskEvent"("taskId", "occurredAt");

-- AddForeignKey
ALTER TABLE "workflows"."WorkflowTaskEvent" ADD CONSTRAINT "WorkflowTaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflows"."WorkflowTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: (taskId, step) 부분 unique — 활성(SENDING/SENT) 발송의 중복 SMTP 차단(§4.2·§6.2).
-- Prisma 스키마로 표현 불가하므로 raw SQL로만 존재한다(애플리케이션 tx 가드가 1차 방어, 이 인덱스는 경합 백스톱).
CREATE UNIQUE INDEX "MailDelivery_taskId_step_active_key" ON "workflows"."MailDelivery"("taskId", "step") WHERE "taskId" IS NOT NULL AND "status" IN ('SENDING', 'SENT');
