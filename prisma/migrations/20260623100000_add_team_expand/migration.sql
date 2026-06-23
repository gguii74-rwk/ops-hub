-- AddTeam (expand) — department→Team 이관. department 컬럼은 유지(task-07에서 drop).
-- 모든 식별자 kernel 정규화(F6). 단일 트랜잭션 — 사전 단언 실패 시 전체 롤백.
BEGIN;

-- gen_random_uuid() 가용성(PG<13 안전망; PG13+는 무해). pgcrypto가 같은 함수 제공.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "kernel"."Team" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "leadUserId" TEXT,
  "active"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "kernel"."User" ADD COLUMN "teamId" TEXT;

INSERT INTO "kernel"."Team" ("id", "name", "updatedAt")
SELECT gen_random_uuid()::text, d.department, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "department" AS department FROM "kernel"."User" WHERE "department" IS NOT NULL) d;

UPDATE "kernel"."User" u
SET "teamId" = t."id"
FROM "kernel"."Team" t
WHERE u."department" IS NOT NULL AND u."department" = t."name";

DO $$
DECLARE unmapped INTEGER;
BEGIN
  SELECT count(*) INTO unmapped FROM "kernel"."User"
  WHERE "department" IS NOT NULL AND "teamId" IS NULL;
  IF unmapped <> 0 THEN
    RAISE EXCEPTION 'department→Team 이관 실패: 미이관 멤버십 % 건', unmapped;
  END IF;
END $$;

ALTER TABLE "kernel"."User" ADD CONSTRAINT "User_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "kernel"."Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kernel"."Team" ADD CONSTRAINT "Team_leadUserId_fkey"
  FOREIGN KEY ("leadUserId") REFERENCES "kernel"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_teamId_idx" ON "kernel"."User"("teamId");
CREATE INDEX "Team_leadUserId_idx" ON "kernel"."Team"("leadUserId");

COMMIT;
