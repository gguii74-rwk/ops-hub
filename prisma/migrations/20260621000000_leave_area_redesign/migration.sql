-- AlterEnum: MailDeliveryStatus에 PENDING, CANCELLED 추가
-- Postgres: ADD VALUE는 개별 실행(동일 트랜잭션에서 새 value 사용 불가 — 여기선 사용하지 않으므로 안전)
ALTER TYPE "workflows"."MailDeliveryStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "workflows"."MailDeliveryStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterTable: LeaveRequest 관리자 귀속·soft-delete 필드
ALTER TABLE "leave"."LeaveRequest"
  ADD COLUMN "createdByAdminId"  TEXT,
  ADD COLUMN "createdByAdminAt"  TIMESTAMP(3),
  ADD COLUMN "modifiedByAdminId" TEXT,
  ADD COLUMN "modifiedByAdminAt" TIMESTAMP(3),
  ADD COLUMN "deletedByAdminId"  TEXT,
  ADD COLUMN "deletedAt"         TIMESTAMP(3),
  ADD COLUMN "deleteReason"      TEXT;
CREATE INDEX "LeaveRequest_deletedAt_idx" ON "leave"."LeaveRequest"("deletedAt");

-- AlterTable: MailDelivery outbox 필드
ALTER TABLE "workflows"."MailDelivery"
  ADD COLUMN "leaveRequestId" TEXT,
  ADD COLUMN "eventType"      TEXT,
  ADD COLUMN "attempts"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil"    TIMESTAMP(3),
  ADD COLUMN "workerId"       TEXT;
CREATE UNIQUE INDEX "MailDelivery_leaveRequestId_eventType_key" ON "workflows"."MailDelivery"("leaveRequestId", "eventType");
CREATE INDEX "MailDelivery_leaveRequestId_idx" ON "workflows"."MailDelivery"("leaveRequestId");
CREATE INDEX "MailDelivery_status_lockedUntil_idx" ON "workflows"."MailDelivery"("status", "lockedUntil");
