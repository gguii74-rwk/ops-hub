# task-01 — FK → RESTRICT 스키마·마이그레이션

**목적:** `NavigationItem`의 두 FK(`parentId` self-ref, `requiredPermissionId`)를 `ON DELETE SET NULL` → `ON DELETE RESTRICT`로 바꿔 fail-closed로 만든다(D2/D8/D11). 컬럼 변경 없음, 제약 동작만.

## Files

- **Modify:** `prisma/schema.prisma` — `NavigationItem`의 `parent`·`requiredPermission` relation에 `onDelete: Restrict` 추가.
- **Create:** `prisma/migrations/20260622030000_navigation_fk_restrict/migration.sql`
- **Create (test):** `tests/prisma/navigation-fk-restrict.test.ts`

## Prep

- 스펙 §4·§12, 결정 D2/D8/D11 읽기.
- 엔트리포인트 §Shared Contracts **SC-1**(마이그레이션 사실·기존 제약 이름).
- 기존 제약 정의 출처: `prisma/migrations/20260617225534_init/migration.sql:576,579`.
- 기존 schema relation: `prisma/schema.prisma:286~304`(NavigationItem), `:221~235`(Permission, back-ref `menuItems`).

## Deps

없음.

## Cautions

- **`prisma migrate dev`를 돌려 마이그레이션을 "생성"하지 말 것.** 로컬에 DB가 없고(빌드/테스트는 DB 불요), 자동 생성은 예측 불가한 diff를 만든다. **마이그레이션 SQL을 손으로 작성**하고 schema relation을 일치시킨다(이 저장소 다른 마이그레이션과 동일 관행).
- **컬럼/인덱스를 건드리지 말 것.** 오직 두 FK 제약의 drop+add만. `@@index([parentId, sortOrder])`·`@@index([requiredPermissionId])`는 유지.
- FK 동작의 실제 DB 강제는 dev 배포(`prisma migrate deploy`)에서 검증된다. 본 태스크 테스트는 **마이그레이션 SQL 텍스트가 RESTRICT를 담는지**를 고정하는 회귀 가드다(누가 SET NULL로 되돌리는 것 방지). 모킹 prisma로는 DB 제약을 실행할 수 없다 — 정직하게 텍스트 단언으로 한다.

## Step 1 — 실패 테스트: 마이그레이션 SQL이 두 FK를 RESTRICT로 정의

`tests/prisma/navigation-fk-restrict.test.ts` 생성:

```ts
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
```

실행: `npm test -- navigation-fk-restrict` → **FAIL**(마이그레이션 파일 없음 → readFileSync throw).

## Step 2 — 마이그레이션 SQL 작성

`prisma/migrations/20260622030000_navigation_fk_restrict/migration.sql` 생성:

```sql
-- NavigationItem FK 동작을 ON DELETE SET NULL → RESTRICT로 변경(fail-closed). 컬럼 변경 없음.
-- ① requiredPermissionId: 참조 Permission 삭제 시 메뉴가 공개(null)로 전락하는 것 방지(D8/F-3).
-- ② parentId(self-ref): 부모 삭제 시 자식 top-level 고아화·cascade 레이스 방지(D11/F-4).

ALTER TABLE "kernel"."NavigationItem" DROP CONSTRAINT "NavigationItem_parentId_fkey";
ALTER TABLE "kernel"."NavigationItem" DROP CONSTRAINT "NavigationItem_requiredPermissionId_fkey";

ALTER TABLE "kernel"."NavigationItem" ADD CONSTRAINT "NavigationItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "kernel"."NavigationItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kernel"."NavigationItem" ADD CONSTRAINT "NavigationItem_requiredPermissionId_fkey" FOREIGN KEY ("requiredPermissionId") REFERENCES "kernel"."Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

실행: `npm test -- navigation-fk-restrict` → **PASS**.

## Step 3 — schema relation에 `onDelete: Restrict` 명시(드리프트 방지)

`prisma/schema.prisma`의 `NavigationItem` 모델에서 두 relation 라인을 수정:

```prisma
  parent               NavigationItem?  @relation("NavigationTree", fields: [parentId], references: [id], onDelete: Restrict)
```

```prisma
  requiredPermission   Permission?      @relation(fields: [requiredPermissionId], references: [id], onDelete: Restrict)
```

(다른 필드·인덱스·`@@schema("kernel")`는 그대로.)

실행: `npm run prisma:validate` → 스키마 유효. (선택: `npm run prisma:generate` — 다음 노트북에서 stale client면 필요.)

## Acceptance Criteria

- `npm test -- navigation-fk-restrict` → 4 케이스 PASS.
- `npm run prisma:validate` → `The schema ... is valid`.
- `npm run typecheck` → 0 errors.
- `git diff prisma/schema.prisma` → 두 relation에 `onDelete: Restrict`만 추가, 그 외 변경 없음.
- (수동·dev) `prisma migrate deploy` 후: 참조된 Permission/부모 NavigationItem 삭제가 DB에서 거부됨(스펙 §11 fail-closed). 본 단계 코드 게이트 아님 — dev 배포 검증 항목으로 기록.
