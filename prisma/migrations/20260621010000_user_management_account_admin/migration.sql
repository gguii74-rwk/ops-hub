-- AlterEnum: UserStatus에 PENDING·REJECTED 추가
-- Postgres: ADD VALUE는 개별 실행(동일 트랜잭션에서 새 value 사용 불가 — 여기선 사용하지 않으므로 안전)
ALTER TYPE "kernel"."UserStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "kernel"."UserStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- AlterTable: User 계정수명주기 필드 추가 + passwordHash nullable 전환
-- passwordHash DROP NOT NULL: 기존 행 모두 값 보유 — 무손실 nullable 전환
ALTER TABLE "kernel"."User"
  ADD COLUMN "mustChangePassword"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passwordChangedAt"    TIMESTAMP(3),
  ADD COLUMN "sessionInvalidatedAt" TIMESTAMP(3),
  ADD COLUMN "emailVerifiedAt"      TIMESTAMP(3),
  ADD COLUMN "emailVerifyTokenHash" TEXT,
  ADD COLUMN "emailVerifyExpiresAt" TIMESTAMP(3),
  ALTER COLUMN "passwordHash" DROP NOT NULL;
CREATE INDEX "User_status_idx" ON "kernel"."User"("status");

-- CreateTable: RateBucket — D18 레이트리밋 DB-backed durable
CREATE TABLE "kernel"."RateBucket" (
    "id"              TEXT NOT NULL,
    "scope"           TEXT NOT NULL,
    "key"             TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "count"           INTEGER NOT NULL DEFAULT 0,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateBucket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RateBucket_scope_key_key" ON "kernel"."RateBucket"("scope", "key");
CREATE INDEX "RateBucket_scope_windowStartedAt_idx" ON "kernel"."RateBucket"("scope", "windowStartedAt");
