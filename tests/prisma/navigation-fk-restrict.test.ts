import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 마이그레이션 SQL을 읽어 두 FK가 ON DELETE RESTRICT로 정의됐는지 고정한다(SET NULL 회귀 방지).
// 실제 DB 강제는 dev 배포에서 검증 — 여기선 SSOT인 SQL 텍스트를 가드한다.
const sql = readFileSync(
  fileURLToPath(new URL("../../prisma/migrations/20260622030000_navigation_fk_restrict/migration.sql", import.meta.url)),
  "utf8",
);

// 공백 정규화(개행·연속 공백 흡수)로 SQL 포맷 흔들림에 강인하게 매칭.
const norm = sql.replace(/\s+/g, " ");

describe("navigation FK → RESTRICT 마이그레이션", () => {
  it("parentId FK를 ON DELETE RESTRICT로 재정의한다", () => {
    expect(norm).toContain(
      `ADD CONSTRAINT "NavigationItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "kernel"."NavigationItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    );
  });
  it("requiredPermissionId FK를 ON DELETE RESTRICT로 재정의한다", () => {
    expect(norm).toContain(
      `ADD CONSTRAINT "NavigationItem_requiredPermissionId_fkey" FOREIGN KEY ("requiredPermissionId") REFERENCES "kernel"."Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    );
  });
  it("두 FK의 기존 제약을 먼저 DROP한다", () => {
    expect(norm).toContain(`DROP CONSTRAINT "NavigationItem_parentId_fkey"`);
    expect(norm).toContain(`DROP CONSTRAINT "NavigationItem_requiredPermissionId_fkey"`);
  });
  it("SET NULL 동작을 남기지 않는다", () => {
    expect(norm).not.toContain("ON DELETE SET NULL");
  });
});
