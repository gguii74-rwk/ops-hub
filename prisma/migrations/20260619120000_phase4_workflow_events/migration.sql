-- CreateEnum
CREATE TYPE "workflows"."MailDeliveryStatus" AS ENUM ('SENDING', 'SENT', 'FAILED');

-- AlterTable: MailDelivery.status — 2단(임시 default로 추가 후 제거).
-- main의 기존 MailDelivery 행은 sentAt NOT NULL(@default(now()))인 '완료된 발송'이므로 임시 default 'SENT'로 backfill한다.
-- (신규 앱 행은 항상 status를 명시 생성하므로 이 default는 오직 기존 행 backfill에만 영향을 준다.)
-- 'SENDING'을 기본값으로 쓰면 과거 발송이 진행 중으로 둔갑해 cancel 게이트(hasActiveSending)와
-- 활성 unique 인덱스를 막으므로 금지한다(§4.2).
ALTER TABLE "workflows"."MailDelivery" ADD COLUMN "status" "workflows"."MailDeliveryStatus" NOT NULL DEFAULT 'SENT';
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
