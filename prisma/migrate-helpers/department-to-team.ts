// expand 마이그레이션 본문 SQL. 모든 식별자 kernel 정규화(F6). 단일 트랜잭션은 .sql 파일이 감싼다.
// Team.id는 gen_random_uuid()::text. PG13+ 코어 내장이지만 PG<13 안전망으로 .sql 선두에 CREATE EXTENSION pgcrypto(아래).
// name=원본 department 값(정규화는 admin이 /admin/teams 리네임).
export const ENABLE_UUID = `CREATE EXTENSION IF NOT EXISTS pgcrypto;`;

export const TEAM_TABLE_DDL = `
CREATE TABLE "kernel"."Team" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "leadUserId" TEXT,
  "active"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);`;

export const USER_TEAMID_DDL = `
ALTER TABLE "kernel"."User" ADD COLUMN "teamId" TEXT;`;

// distinct 비-null department → Team 1행. 같은 department 문자열은 1팀으로 dedup.
export const SEED_TEAMS_FROM_DEPARTMENT = `
INSERT INTO "kernel"."Team" ("id", "name", "updatedAt")
SELECT gen_random_uuid()::text, d.department, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "department" AS department FROM "kernel"."User" WHERE "department" IS NOT NULL) d;`;

export const LINK_USERS_TO_TEAM = `
UPDATE "kernel"."User" u
SET "teamId" = t."id"
FROM "kernel"."Team" t
WHERE u."department" IS NOT NULL AND u."department" = t."name";`;

// 사전 단언(drop은 task-07이지만, expand 단계에서 미이관 0을 즉시 검증해 데이터 결함을 조기 차단).
// 비-null department인데 teamId 미할당이 있으면 트랜잭션 abort.
export const ASSERT_ALL_MAPPED = `
DO $$
DECLARE unmapped INTEGER;
BEGIN
  SELECT count(*) INTO unmapped FROM "kernel"."User"
  WHERE "department" IS NOT NULL AND "teamId" IS NULL;
  IF unmapped <> 0 THEN
    RAISE EXCEPTION 'department→Team 이관 실패: 미이관 멤버십 % 건', unmapped;
  END IF;
END $$;`;

export const FK_CONSTRAINTS = `
ALTER TABLE "kernel"."User" ADD CONSTRAINT "User_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "kernel"."Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kernel"."Team" ADD CONSTRAINT "Team_leadUserId_fkey"
  FOREIGN KEY ("leadUserId") REFERENCES "kernel"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_teamId_idx" ON "kernel"."User"("teamId");
CREATE INDEX "Team_leadUserId_idx" ON "kernel"."Team"("leadUserId");`;

// 마이그레이션 본문 순서(단일 트랜잭션). leadUserId는 비움(D2 step5 — 이후 /admin/teams 지정).
export function expandMigrationSql(): string {
  return [
    ENABLE_UUID,
    TEAM_TABLE_DDL,
    USER_TEAMID_DDL,
    SEED_TEAMS_FROM_DEPARTMENT,
    LINK_USERS_TO_TEAM,
    ASSERT_ALL_MAPPED,
    FK_CONSTRAINTS,
  ].join("\n");
}
