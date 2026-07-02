-- AlterTable (additive — D4·D13. 기존 행은 cc/bcc NULL → 소비자가 []로 해석)
ALTER TABLE "workflows"."MailDelivery" ADD COLUMN "cc" JSONB,
ADD COLUMN "bcc" JSONB;

-- CreateTable (D2 주소록)
CREATE TABLE "workflows"."MailContact" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailContact_email_key" ON "workflows"."MailContact"("email");
