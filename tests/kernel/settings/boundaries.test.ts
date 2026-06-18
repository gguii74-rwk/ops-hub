import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[])
    .map(String)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => join(dir, f));
}

describe("경계 가드", () => {
  it("modules의 kernel/settings import는 reader뿐", () => {
    const offenders: string[] = [];
    const re = /from\s+["'](@\/kernel\/settings[^"']*)["']/g;
    for (const file of filesUnder("src/modules")) {
      const src = readFileSync(file, "utf8");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (m[1] !== "@/kernel/settings/reader") offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("SystemSetting 직접 write는 repository.ts에서만 (createMany·raw SQL 포함)", () => {
    const offenders: string[] = [];
    // Prisma client write 멤버 — createMany까지 명시. (`create\b`는 'create'와 'Many' 사이에
    // 단어경계가 없어 createMany를 매치하지 못하므로 별도 alternation으로 넣는다.)
    const writeRe = /systemSetting\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
    // raw SQL 우회 차단: $executeRaw*가 SystemSetting을 건드리거나, SQL write 키워드가 테이블을 직접 대상으로.
    // ({0,400}는 catastrophic backtracking·파일 전역 오탐 방지용 상한.)
    const rawWriteRe =
      /\$executeRaw(?:Unsafe)?\b[\s\S]{0,400}?SystemSetting|(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?SystemSetting"?/i;
    for (const file of filesUnder("src")) {
      if (file.replace(/\\/g, "/").endsWith("kernel/settings/repository.ts")) continue;
      const src = readFileSync(file, "utf8");
      if (writeRe.test(src) || rawWriteRe.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("지정 모듈은 server-only를 import한다", () => {
    const mustBeServerOnly = [
      "src/kernel/settings/catalog.ts",
      "src/kernel/settings/repository.ts",
      "src/kernel/settings/service.ts",
      "src/kernel/settings/reader.ts",
      "src/kernel/settings/index.ts",
      "src/lib/env/index.ts",
    ];
    for (const f of mustBeServerOnly) {
      expect(readFileSync(f, "utf8"), f).toContain('import "server-only"');
    }
  });
});
