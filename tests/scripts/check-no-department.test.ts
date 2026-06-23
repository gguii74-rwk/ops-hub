import { describe, it, expect } from "vitest";
import { findHits, ALLOWLIST, WORD } from "../../scripts/check-no-department.mjs";

describe("F8 게이트 로직", () => {
  it("비-allowlist 파일의 department 줄을 잡는다", () => {
    expect(findHits("src/foo.ts", "select: { department: true }")).toHaveLength(1);
  });
  it("teamId만 있는 줄은 안 잡는다", () => {
    expect(findHits("src/foo.ts", "select: { teamId: true }")).toHaveLength(0);
  });
  it("allowlist 파일은 department가 있어도 0건(마이그레이션 아티팩트 제외)", () => {
    expect(findHits("prisma/migrate-helpers/department-to-team.ts", 'SELECT "department"')).toHaveLength(0);
    expect(findHits("tests/prisma/team-migration.test.ts", '"department" IS NOT NULL')).toHaveLength(0);
  });
  it("ALLOWLIST는 이관 헬퍼/테스트를 정확히 포함(posix 경로)", () => {
    expect(ALLOWLIST.has("prisma/migrate-helpers/department-to-team.ts")).toBe(true);
    expect(ALLOWLIST.has("tests/prisma/team-migration.test.ts")).toBe(true);
  });
  it("WORD는 단어경계(teamId 미일치, department 일치)", () => {
    expect(WORD.test("teamId")).toBe(false);
    expect(WORD.test("department")).toBe(true);
  });
});
