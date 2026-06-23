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
