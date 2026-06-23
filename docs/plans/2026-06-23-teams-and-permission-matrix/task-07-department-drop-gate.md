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

`scripts/check-no-department.mjs` — node 단독(rg 의존 회피, 크로스플랫폼). **스캔 범위 = 엔트리포인트 F8 계약(`src`+`tests`+`prisma`, `migrations/` 제외)**. `department`를 정당하게 포함하는 **마이그레이션 아티팩트는 명시 allowlist로 제외**(reader가 아니라 이관 로직/검증). 게이트 로직(`WORD`/`ALLOWLIST`/`findHits`)을 export해 자체 테스트가 실제 동작을 검증한다(F-C — 자기모순 제거):
```js
// F8 게이트: 마이그레이션·allowlist 외 src/tests/prisma에 `department` 단어가 0건이어야 통과.
// department 컬럼 drop(task-07) 전 전수 전환을 기계 검증한다(spec §10 F8 DEFERRED_TO_IMPL).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep, posix } from "node:path";
import { pathToFileURL } from "node:url";

export const ROOTS = ["src", "tests", "prisma"];                       // 엔트리포인트 F8 계약 범위(prisma 포함)
export const EXCLUDE_DIRS = new Set(["node_modules", ".next", "migrations"]); // 마이그레이션 SQL은 department 포함이 정상
export const EXT = /\.(ts|tsx|mjs|js|prisma)$/;
export const WORD = /\bdepartment\b/i;

// 마이그레이션 산출물 — department를 정당하게 포함(이관 로직/검증). reader가 아니므로 drop과 무관.
// posix(슬래시) 상대경로 정확 일치. 항목 추가 시 "왜 정당한지" 주석 필수(보수성 유지).
export const ALLOWLIST = new Set([
  "prisma/migrate-helpers/department-to-team.ts", // 이관 SQL 빌더(task-01) — department→Team 변환 본체
  "tests/prisma/team-migration.test.ts",          // expand/drop 마이그레이션 SQL 적합성 단언(task-01·07)
  "tests/scripts/check-no-department.test.ts",     // 이 게이트의 자체 테스트(allowlist 동작 검증)
]);

const toPosix = (p) => p.split(sep).join(posix.sep);
// 한 파일의 department 히트 목록(allowlist면 빈 배열). 테스트가 직접 호출하는 순수 함수.
export function findHits(relPath, text) {
  if (ALLOWLIST.has(toPosix(relPath))) return [];
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => { if (WORD.test(line)) out.push(`${toPosix(relPath)}:${i + 1}: ${line.trim()}`); });
  return out;
}

function walk(dir, hits) {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, hits);
    else if (EXT.test(name)) {
      let text; try { text = readFileSync(p, "utf8"); } catch { continue; }
      hits.push(...findHits(p, text));
    }
  }
}

export function runGate() {
  const hits = [];
  for (const r of ROOTS) { try { walk(r, hits); } catch {} }
  if (hits.length) {
    console.error(`F8 게이트 실패 — 마이그레이션/allowlist 외 department 참조 ${hits.length}건(drop 차단):`);
    for (const h of hits) console.error("  " + h);
    process.exit(1);
  }
  console.log("F8 게이트 통과 — department 참조 0건(allowlist 제외).");
}

// CLI 직접 실행일 때만 게이트 수행(테스트 import 시에는 실행 안 됨).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runGate();
```
`package.json` scripts에 추가:
```json
    "check:no-department": "node scripts/check-no-department.mjs",
```
실행: `npm run check:no-department`. task-04·05가 완료됐으면 **통과**해야 한다. **잔존 참조가 잡히면 그 파일을 teamId/teamName으로 마저 전환**(이 task의 본 작업 — 게이트가 누락을 드러냄). 0건이 될 때까지 반복. 새 마이그레이션 아티팩트가 정당하게 `department`를 포함하면 ALLOWLIST에 경로+이유를 추가(무분별 추가 금지 — reader는 전환해야 함).

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
- **F8 게이트 자체 테스트**(스크립트 실제 로직 import — 정규식 복제 아님, 드리프트 방지): `tests/scripts/check-no-department.test.ts`. 이 파일은 ALLOWLIST에 있어 `department` 리터럴을 자유롭게 포함할 수 있다(자기모순 제거 — F-C). `findHits`/`ALLOWLIST`/`WORD`를 import해 동작을 검증한다:
  ```ts
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
  ```
  (import 시 `runGate()`는 실행되지 않는다 — 스크립트가 CLI 진입점일 때만 돈다. vitest가 `.mjs` import를 처리하는지 확인 — esbuild 변환 대상. 안 되면 동일 로직의 `.ts` 모듈로 분리하고 `.mjs`가 re-export.)

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

### 6. 배포 계약 — db:seed 필수 + smoke(F-I)

본 증분의 새 권한/메뉴/위임-admin grant는 **`prisma migrate deploy`가 아니라 `npm run db:seed`로** 생성된다(D9 부트스트랩 catalog→Permission/NavigationItem create-if-absent + D10 `applyTeamsPermissionUpgrade`). 따라서 마이그레이션만 적용하고 db:seed를 건너뛰면 **게이트는 다 통과해도** `admin.teams`/`admin.roles` 권한·nav가 없고 위임 admin이 새 화면에 잠긴다(F-I). 배포 런북(CLAUDE.md)에 이미 db:seed가 있으나, 본 task가 **명시·검증**한다:

- **배포 순서(필수 — stop→migrate→start, PD1 정합·F-T):** `npm run build`(새 릴리즈 빌드, DB 무관) → `pm2 stop ops-hub`(+워커 — drop이 비가역이라 **old 코드가 `department`를 읽는 동안 drop 금지**) → **DB 백업**(drop 비가역, 롤백=백업 복원) → `prisma migrate deploy`(expand+drop, **old 코드 정지 상태에서**) → **`npm run db:seed`**(부트스트랩+D10 업그레이드) → `npm run db:seed:demo`(선택) → smoke 검증(아래) → `pm2 start ops-hub`(새 릴리즈 기동). **`pm2 restart` 단독 금지** — drop을 old 코드 위에서 돌려 version skew outage(F-T)가 난다.
- **smoke 검증(배포 후, 수동/스크립트 AC):** db:seed 후 다음이 존재해야 한다 —
  - `Permission`: `admin.teams:view`/`:configure`, `admin.roles:view`/`:configure` 행.
  - `NavigationItem`: `/admin/teams`, `/admin/roles` 항목.
  - `RolePermission`: 위임 `admin` 역할에 `admin.teams:view`/`admin.teams:configure`/`admin.roles:view` grant(D10). `admin.roles:configure`는 어떤 역할에도 없어야 함(OWNER 전용).
  - 확인 쿼리 예: `psql "$DATABASE_URL" -c "SELECT resource,action FROM kernel.\"Permission\" WHERE resource IN ('admin.teams','admin.roles');"` (psql은 `?schema=public` 제거).
- (D10이 seed 기반인 이유: grant가 참조하는 Permission 행 자체가 seed create-if-absent로 생기므로 db:seed는 어차피 필수 — 별도 Prisma 데이터 마이그레이션으로 빼도 db:seed 의존이 사라지지 않는다. 따라서 db:seed를 계약화하고 smoke로 검증.)

## Acceptance Criteria
- `npm run check:no-department` → "F8 게이트 통과 — department 참조 0건."
- `npm run prisma:validate` → valid(User.department 없음).
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 errors.
- `npm test` → 전 스위트 PASS(team-migration drop 재단언 + F8 정규식 + 앞 task 보안 negative 포함).
- `npm run build` → 성공.
- drop 마이그레이션이 drop 전 재단언(미이관 0)을 포함.
- **F-I 배포 계약**: 배포 런북에 `npm run db:seed`가 migrate deploy 직후 필수 단계로 명시 + db:seed 후 `admin.teams`/`admin.roles` Permission·Nav·위임-admin grant 존재 smoke 확인.
- **F-T 배포 순서 안전**: 런북이 build→stop(+워커)→backup→migrate deploy→db:seed→smoke→start 순(stop→migrate→start, PD1 정합). drop을 old 코드가 떠 있는 채로 실행하지 않음(`pm2 restart` 단독 금지).

## Cautions
- **Don't** F8 게이트(`check:no-department`) 미통과 상태로 department를 drop. Reason: 잔존 reader가 런타임/컴파일 실패(F8 critical). 게이트가 0건일 때만 진행.
- **Don't** drop 마이그레이션을 재단언 없이 작성. Reason: 미이관 멤버십이 남은 채 source를 지우면 복구 불가(§4 step3·F6).
- **Don't** 이 task를 task-04·05 완료 전에 실행. Reason: reader가 남아 typecheck/게이트가 실패한다. PD1 contract는 **마지막**.
- **Don't** 배포 시 `npm run db:seed`를 건너뛴다. Reason: 새 권한(`admin.teams`/`admin.roles`)·nav·위임-admin grant는 migrate가 아니라 seed가 만든다(D9/D10) — 건너뛰면 게이트는 통과해도 위임 admin이 새 화면에 잠긴다(F-I). migrate deploy 직후 db:seed + smoke 필수.
- **Don't** drop 마이그레이션을 old 코드가 떠 있는 채로 `migrate deploy`한다(`pm2 restart`만으로 끝낸다). Reason: drop이 비가역인데 old 프로세스가 `department`를 읽어 version skew outage(F-T). 반드시 build → stop(+워커) → backup → migrate → seed → smoke → start.
- **Don't** 게이트 오탐을 통과시키려 `WORD` 정규식을 느슨하게. Reason: 게이트의 보수성이 F8 안전. 정말 무해한 잔존은 해당 줄을 수정(삭제/teamId로 표현)해 0건을 만든다.
- **Don't** reader(런타임에 `department`를 읽는 코드)를 ALLOWLIST에 넣어 게이트를 통과시킨다. Reason: ALLOWLIST는 **마이그레이션 아티팩트**(이관 SQL 빌더·이관/ drop 적합성 테스트·게이트 자체 테스트)만 — reader는 반드시 teamId로 전환. allowlist 남용은 F8(drop 후 런타임 실패)을 되살린다.
- **Don't** 게이트 자체 테스트에서 `WORD` 정규식을 복제. Reason: 스크립트의 `findHits`/`WORD`/`ALLOWLIST`를 import해 실제 로직을 검증해야 드리프트가 없다(자기 테스트가 allowlist에 있어 `department` 리터럴 자유 — F-C 자기모순 제거의 핵심).
