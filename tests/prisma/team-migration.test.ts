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
    // bare "User"/"Team"(앞에 "." 없는, 즉 schema-qualified 아닌) 참조가 없어야 한다.
    // PostgreSQL 인용 식별자 패턴: "kernel"."User" → "User" 앞이 "." — 이 패턴만 허용.
    expect(sql).not.toMatch(/(?<!\"\.)\"User\"/);
    expect(sql).not.toMatch(/(?<!\"\.)\"Team\"/);
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
    // PostgreSQL 인용 식별자 패턴: "kernel"."User" → "User" 앞이 "." — 이 패턴만 허용.
    expect(sql).not.toMatch(/(?<!\"\.)\"User\"/);
    expect(sql).not.toMatch(/(?<!\"\.)\"Team\"/);
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

// task-07: drop 마이그레이션 재단언 정합성
describe("drop 마이그레이션 SQL 정합(task-07)", () => {
  const sql = readFileSync("prisma/migrations/20260623200000_drop_department/migration.sql", "utf8");
  it("drop 마이그레이션은 drop 전 미이관 0 재단언을 포함한다", () => {
    expect(sql).toMatch(/"department" IS NOT NULL AND "teamId" IS NULL/);
    expect(sql.indexOf("RAISE EXCEPTION")).toBeLessThan(sql.indexOf("DROP COLUMN"));
  });
});
