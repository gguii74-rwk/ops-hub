# task-01 — Team 스키마 + expand 마이그레이션(department→Team)

**목적:** `Team` 모델·`User.teamId` 추가 + `department`→`Team` 데이터 이관(단일 트랜잭션, 스키마 정규화, 사전 단언). `department` 컬럼/필드는 **유지**(PD1 expand — drop은 task-07).

## Files
- Modify: `prisma/schema.prisma` (Team 모델 + User.teamId/team/ledTeams. **department는 그대로 둔다**)
- Create: `prisma/migrations/20260623100000_add_team_expand/migration.sql`
- Create: `tests/prisma/team-migration.test.ts` (이관 적합성 — SQL 변환 함수 단위검증)
- Create: `prisma/migrate-helpers/department-to-team.ts` (이관 SQL을 생성하는 순수 함수 — 테스트 가능)

## Prep
- 엔트리포인트 §Shared Contracts "스키마 추가", "PD1".
- 기존 마이그레이션 스타일: `prisma/migrations/20260617225534_init/migration.sql`(kernel."User" 정의). `User`/`Team` 모두 `kernel` 스키마 — **모든 raw SQL은 `kernel."..."`로 정규화**(F6: bare `"User"`는 search_path 의존).

## Deps
없음.

## Steps

### 1. schema.prisma — Team 모델 + User 관계 추가 (department 유지)

`model User { ... }`에 `teamId`/`team`/`ledTeams`와 인덱스를 추가하고, 파일에 `Team` 모델을 추가한다. **`department String?`는 삭제하지 않는다**(PD1).

User 모델 — 기존 `permissionOverrides`/`auditLogs` 관계 줄 아래, `@@index` 블록 위에 추가:
```prisma
  roleAssignments     UserAccessRole[]
  permissionOverrides UserPermissionOverride[]
  auditLogs           AuditLog[]               @relation("AuditActor")

  teamId   String?                                              // 신규 — 1인 1팀(D1)
  team     Team?   @relation("TeamMembers", fields: [teamId], references: [id], onDelete: SetNull)
  ledTeams Team[]  @relation("TeamLead")                        // 팀장으로 있는 팀들

  @@index([employmentType, jobFunction])
  @@index([systemRole])
  @@index([status])
  @@index([emailVerifyTokenHash])
  @@index([teamId])
  @@schema("kernel")
}
```

`Permission` 모델 정의 위(또는 `AccessRole` 위)에 `Team` 모델 추가:
```prisma
model Team {
  id         String   @id @default(cuid())
  name       String
  leadUserId String?
  lead       User?    @relation("TeamLead", fields: [leadUserId], references: [id], onDelete: SetNull)
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  members    User[]   @relation("TeamMembers")

  @@index([leadUserId])
  @@schema("kernel")
}
```

검증: `npm run prisma:validate` → PASS, `npm run prisma:generate` → 성공(Prisma Client에 `Team`/`teamId`/`team`/`ledTeams`와 **기존 `department` 둘 다** 존재).

### 2. 이관 SQL 생성 순수 함수 (테스트 가능)

`prisma/migrate-helpers/department-to-team.ts`:
```ts
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
```

### 3. 실패 테스트 작성 → 실행(FAIL 기대)

`tests/prisma/team-migration.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  expandMigrationSql,
  SEED_TEAMS_FROM_DEPARTMENT,
  LINK_USERS_TO_TEAM,
  ASSERT_ALL_MAPPED,
} from "../../prisma/migrate-helpers/department-to-team";

describe("department→Team expand migration SQL", () => {
  it("모든 식별자를 kernel 스키마로 정규화한다(F6: bare User/Team 금지)", () => {
    const sql = expandMigrationSql();
    // bare "User"/"Team"(앞에 kernel." 없는) 참조가 없어야 한다.
    expect(sql).not.toMatch(/(?<!kernel\.)"User"/);
    expect(sql).not.toMatch(/(?<!kernel\.)"Team"/);
  });

  it("distinct 비-null department만 Team으로 시드한다", () => {
    expect(SEED_TEAMS_FROM_DEPARTMENT).toContain("DISTINCT");
    expect(SEED_TEAMS_FROM_DEPARTMENT).toContain(`"department" IS NOT NULL`);
  });

  it("teamId 연결은 department=name 정확 매칭이다", () => {
    expect(LINK_USERS_TO_TEAM).toContain(`u."department" = t."name"`);
    expect(LINK_USERS_TO_TEAM).toContain(`u."department" IS NOT NULL`);
  });

  it("drop 전 미이관 0 사전 단언을 포함한다(department NOT NULL AND teamId NULL → abort)", () => {
    expect(ASSERT_ALL_MAPPED).toContain(`"department" IS NOT NULL AND "teamId" IS NULL`);
    expect(ASSERT_ALL_MAPPED).toContain("RAISE EXCEPTION");
  });

  it("expand는 department 컬럼을 drop하지 않는다(PD1 — drop은 task-07)", () => {
    expect(expandMigrationSql()).not.toMatch(/DROP\s+COLUMN\s+"department"/i);
  });
});

// F-M — 배포되는 실제 migration.sql을 helper에 바인딩(둘이 어긋나도 helper만 통과하는 drift 차단).
// migration.sql이 helper의 핵심 안전 요소(kernel 정규화·DISTINCT 시드·미이관 단언·FK)를 모두 포함하고 트랜잭션·순서가 맞는지 단언.
describe("배포 migration.sql ↔ helper 정합(F-M)", () => {
  const sql = readFileSync("prisma/migrations/20260623100000_add_team_expand/migration.sql", "utf8");
  it("단일 트랜잭션(BEGIN/COMMIT)", () => {
    expect(sql).toMatch(/^\s*BEGIN;/m);
    expect(sql).toMatch(/COMMIT;\s*$/);
  });
  it("kernel 정규화(bare User/Team 없음)", () => {
    expect(sql).not.toMatch(/(?<!kernel\.)"User"/);
    expect(sql).not.toMatch(/(?<!kernel\.)"Team"/);
  });
  it("helper의 핵심 SQL 조각을 모두 포함(시드·연결·단언·FK)", () => {
    for (const frag of [SEED_TEAMS_FROM_DEPARTMENT, LINK_USERS_TO_TEAM, ASSERT_ALL_MAPPED]) {
      // 공백 정규화 비교(손복사 줄바꿈 차이 허용, 토큰 시퀀스는 동일해야 함).
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();
      expect(norm(sql)).toContain(norm(frag));
    }
  });
  it("미이관 단언이 FK/완료 전에 온다(순서)", () => {
    expect(sql.indexOf("RAISE EXCEPTION")).toBeGreaterThan(-1);
    expect(sql.indexOf("RAISE EXCEPTION")).toBeLessThan(sql.indexOf("User_teamId_fkey"));
  });
  it("expand는 department를 drop하지 않는다(drop은 task-07)", () => {
    expect(sql).not.toMatch(/DROP\s+COLUMN\s+"department"/i);
  });
});
```
(test 상단에 `import { readFileSync } from "node:fs";` 추가. `SEED_TEAMS_FROM_DEPARTMENT` 등은 이미 helper에서 import.)
실행: `npm test -- team-migration` → 모듈 미존재로 **FAIL**(아직 helper 미작성이면 import 에러). helper를 step2에서 먼저 만들었다면, 테스트만 추가하고 실행해 RED→GREEN 확인.

### 4. 마이그레이션 파일 작성

`prisma/migrations/20260623100000_add_team_expand/migration.sql` — `expandMigrationSql()`의 출력과 **동일한 SQL**을 손으로 적되 `BEGIN;`/`COMMIT;`으로 감싸 단일 트랜잭션화:
```sql
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
```
(`migration.sql`과 `department-to-team.ts`는 동일하게 유지 — helper는 DB-less 단위검증용, .sql은 실제 적용본. **drift는 F-M 테스트가 가드**: team-migration.test가 실제 migration.sql을 읽어 helper의 핵심 조각(시드·연결·미이관 단언·FK)·kernel 정규화·순서를 단언하므로, .sql이 안전 로직을 빠뜨리면 테스트가 RED.)

### 5. 테스트 통과 + 커밋
`npm test -- team-migration` → **PASS**. 그 후 task 커밋.

## Acceptance Criteria
- `npm run prisma:validate` → `The schema ... is valid` (Team·teamId 추가, department **존재 유지**).
- `npm run prisma:generate` → 성공.
- `npm run typecheck` → 0 errors(department·teamId 공존, 기존 reader 무변경이라 깨지지 않음).
- `npm test -- team-migration` → helper 단위 + **배포 migration.sql 정합(F-M)** 모두 PASS(.sql이 helper 핵심 SQL·kernel 정규화·순서를 포함).
- `npm run lint` → 0 errors.

## Cautions
- **Don't** `department` 컬럼/필드를 이 task에서 제거. Reason: 20+ reader가 task-04·05에서 전환되기 전까지 typecheck가 깨진다(PD1). drop은 task-07.
- **Don't** raw SQL에서 bare `"User"`/`"Team"`을 쓴다. Reason: search_path 의존으로 잘못된 relation을 타거나 실패(F6). 항상 `kernel."..."`.
- **Don't** department→Team을 trim/lower 정규화한다. Reason: 정확 매칭으로 결정성 보존. 공백/대소문자 변형 중복은 admin이 `/admin/teams` 리네임으로 병합(16명 규모, 허용). 사전 단언이 미이관 0을 보장.
- **Don't** leadUserId를 이관 시 채운다. Reason: D2 step5 — 팀장은 이후 `/admin/teams`에서 지정(불변식 검증 경유).
- **Don't** helper만 테스트하고 배포 `migration.sql`을 검증 안 한 채 둔다. Reason: helper는 통과하는데 손복사한 .sql이 kernel 정규화·미이관 단언·FK를 빠뜨리면 department drop이 잘못된 매핑 위에서 일어나 데이터 손상(F-M). team-migration.test가 실제 .sql을 읽어 helper 핵심 조각과 정합을 단언한다.
- **참고(F8 allowlist):** 이 task가 만드는 `prisma/migrate-helpers/department-to-team.ts`·`tests/prisma/team-migration.test.ts`는 `department`를 정당하게 포함하는 **마이그레이션 아티팩트**다(reader 아님). task-07의 F8 게이트 ALLOWLIST에 등재되어 drop 후에도 게이트를 통과한다 — 여기서 `department`를 teamId로 바꾸려 하지 말 것(이관 로직/검증 본체).
