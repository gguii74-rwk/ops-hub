# task-07 — department drop(contract 마이그레이션) + F8 게이트 + 통합/보안 테스트

**목적:** 모든 reader가 `teamId`로 전환된 뒤 `department`를 제거한다(PD1 contract). **F8 게이트**(마이그레이션 외 `department` 참조 0)를 기계 검증하고, drop 마이그레이션은 drop 전 재단언한다. 마지막에 전 스위트·typecheck·build로 전수 전환을 확정한다.

## Files
- Create: `scripts/check-no-department.mjs` (F8 게이트 — 마이그레이션 외 `\bdepartment\b` == 0)
- Modify: `package.json` (`"check:no-department": "node scripts/check-no-department.mjs"` 스크립트)
- Modify: `prisma/schema.prisma` (`User.department String?` **제거**)
- Create: `prisma/migrations/20260623200000_drop_department/migration.sql`
- (필요 시) Modify: 게이트가 잡아낸 잔존 `department` 참조 파일

## Prep
- 엔트리포인트 §Shared Contracts "PD1"(expand→contract), "F8 검증 게이트".
- task-01 expand 마이그레이션(이미 모든 비-null department→Team 매핑 완료). task-04·05가 모든 reader를 teamId로 전환한 뒤 실행.

## Deps
04, 05 (모든 reader 전환 완료), 06 (seed 부트스트랩/업그레이드 — department 무관이나 순서상 뒤).

## Steps

### 1. F8 게이트 스크립트(실패 우선 — 잔존 참조가 있으면 fail)

`scripts/check-no-department.mjs` — node 단독(rg 의존 회피, 크로스플랫폼):
```js
// F8 게이트: 마이그레이션·문서 외 소스/테스트/seed에 `department` 단어가 0건이어야 통과.
// department 컬럼 drop(task-07) 전 전수 전환을 기계 검증한다(spec §10 F8 DEFERRED_TO_IMPL).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const ROOTS = ["src", "tests"];
const EXTRA_FILES = ["prisma/seed.ts", "prisma/seed-roles.ts", "prisma/seed-permissions.ts", "prisma/seed-demo.ts", "prisma/schema.prisma"];
const EXCLUDE_DIRS = new Set(["node_modules", ".next", "migrations"]);
const EXT = /\.(ts|tsx|mjs|js|prisma)$/;
const WORD = /\bdepartment\b/i;

const hits = [];
function scanFile(path) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return; }
  text.split(/\r?\n/).forEach((line, i) => { if (WORD.test(line)) hits.push(`${path}:${i + 1}: ${line.trim()}`); });
}
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXT.test(name)) scanFile(p);
  }
}
for (const r of ROOTS) { try { walk(r); } catch {} }
for (const f of EXTRA_FILES) { try { if (statSync(f)) scanFile(f.split("/").join(sep)); } catch {} }

if (hits.length) {
  console.error(`F8 게이트 실패 — 마이그레이션 외 department 참조 ${hits.length}건(drop 차단):`);
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log("F8 게이트 통과 — department 참조 0건.");
```
`package.json` scripts에 추가:
```json
    "check:no-department": "node scripts/check-no-department.mjs",
```
실행: `npm run check:no-department`. task-04·05가 완료됐으면 **통과**해야 한다. **잔존 참조가 잡히면 그 파일을 teamId/teamName으로 마저 전환**(이 task의 본 작업 — 게이트가 누락을 드러냄). 0건이 될 때까지 반복.

### 2. schema에서 department 제거

`prisma/schema.prisma` `model User`의 `department String?` 줄을 **삭제**. (teamId/team/ledTeams는 task-01에서 이미 추가됨.)
`npm run prisma:validate` → valid. `npm run prisma:generate` → Prisma Client에서 `department` 사라짐.

이 시점에 `npm run typecheck`가 **잔존 reader를 전부 잡는다**(department 필드 부재). 0 errors여야 한다 — 아니면 step1 게이트가 못 잡은 동적 접근이 있다는 뜻이니 그 파일도 전환.

### 3. drop 마이그레이션(재단언 후 drop)

`prisma/migrations/20260623200000_drop_department/migration.sql`:
```sql
-- DropDepartment (contract, PD1). 모든 reader가 teamId로 전환된 뒤 department 컬럼 제거.
-- drop 전 재단언: 미이관 멤버십(department NOT NULL AND teamId NULL)이 0이어야 한다(§4 step3 안전망).
BEGIN;

DO $$
DECLARE unmapped INTEGER;
BEGIN
  SELECT count(*) INTO unmapped FROM "kernel"."User"
  WHERE "department" IS NOT NULL AND "teamId" IS NULL;
  IF unmapped <> 0 THEN
    RAISE EXCEPTION 'department drop 차단: 미이관 멤버십 % 건(롤백)', unmapped;
  END IF;
END $$;

ALTER TABLE "kernel"."User" DROP COLUMN "department";

COMMIT;
```

> **배포 안전장치(D2 보완 — 런북):** 이 마이그레이션은 **코드 롤백 불가 경계**다. 배포 런북에서 `prisma migrate deploy` **직전 DB 백업** 필수, 롤백 = 백업 복원. 단일 pm2 `stop→migrate→start`라 version skew 없음(F7). expand(task-01)·contract(task-07) 두 마이그레이션이 같은 배포의 `migrate deploy`에서 연달아 적용된다.

### 4. 통합·보안 회귀 확정

이 task는 새 보안 테스트를 많이 추가하기보다, **앞선 task들의 보안 negative가 전 스위트에서 함께 GREEN**임을 확정한다(F2/F3/F5/F9는 task-02·05·06에 위치). 추가로:

- **마이그레이션 정합성 회귀**: `tests/prisma/team-migration.test.ts`(task-01)에 drop 마이그레이션이 재단언을 포함하는지 단언 추가:
  ```ts
  import { readFileSync } from "node:fs";
  it("drop 마이그레이션은 drop 전 미이관 0 재단언을 포함한다", () => {
    const sql = readFileSync("prisma/migrations/20260623200000_drop_department/migration.sql", "utf8");
    expect(sql).toMatch(/"department" IS NOT NULL AND "teamId" IS NULL/);
    expect(sql.indexOf("RAISE EXCEPTION")).toBeLessThan(sql.indexOf("DROP COLUMN"));
  });
  ```
- **F8 게이트 자체 테스트**(스크립트가 잔존 참조를 잡는지): `tests/scripts/check-no-department.test.ts` — 임시 문자열에 `WORD` 정규식을 적용해 매칭/비매칭 검증(스크립트의 `WORD`를 export하거나 정규식을 테스트에 복제). 간단히:
  ```ts
  import { describe, it, expect } from "vitest";
  const WORD = /\bdepartment\b/i;
  describe("F8 게이트 정규식", () => {
    it("department 단어를 잡는다", () => { expect(WORD.test('select: { department: true }')).toBe(true); });
    it("teamId만 있는 줄은 안 잡는다", () => { expect(WORD.test('select: { teamId: true }')).toBe(false); });
    it("departmental 같은 부분일치는 단어경계로 잡되, 의도된 식별자 department는 모두 포함", () => {
      expect(WORD.test('const departmentName = x')).toBe(true); // \b 뒤 단어 시작 — 보수적으로 잡힘(오탐 시 수동 화이트리스트)
    });
  });
  ```

### 5. 전수 게이트 통과 + 커밋

순서대로 전부 통과해야 한다:
```bash
npm run check:no-department   # 0건
npm run prisma:validate       # valid (department 없음)
npm run typecheck             # 0 errors (잔존 reader 없음 — F8 기계 검증)
npm run lint                  # 0 errors
npm test                      # 전 스위트 GREEN(보안 negative 포함)
npm run build                 # 성공
```

## Acceptance Criteria
- `npm run check:no-department` → "F8 게이트 통과 — department 참조 0건."
- `npm run prisma:validate` → valid(User.department 없음).
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 errors.
- `npm test` → 전 스위트 PASS(team-migration drop 재단언 + F8 정규식 + 앞 task 보안 negative 포함).
- `npm run build` → 성공.
- drop 마이그레이션이 drop 전 재단언(미이관 0)을 포함.

## Cautions
- **Don't** F8 게이트(`check:no-department`) 미통과 상태로 department를 drop. Reason: 잔존 reader가 런타임/컴파일 실패(F8 critical). 게이트가 0건일 때만 진행.
- **Don't** drop 마이그레이션을 재단언 없이 작성. Reason: 미이관 멤버십이 남은 채 source를 지우면 복구 불가(§4 step3·F6).
- **Don't** 이 task를 task-04·05 완료 전에 실행. Reason: reader가 남아 typecheck/게이트가 실패한다. PD1 contract는 **마지막**.
- **Don't** 게이트 오탐(예: 주석의 "department" 역사 설명)을 무시하고 통과시키려 정규식을 느슨하게. Reason: 게이트의 보수성이 F8 안전. 정말 무해한 잔존은 해당 줄을 수정(삭제/teamId로 표현)해 0건을 만든다.
