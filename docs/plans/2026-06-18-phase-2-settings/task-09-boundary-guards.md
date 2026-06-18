# Task 09 — 경계 가드: modules→reader 전용 + 직접 write 금지 + server-only 고정

**Purpose:** Phase 2 핵심 방어선을 자동 가드로 고정한다. ① 모듈은 `kernel/settings/reader`만 import, ② `SystemSetting` 직접 write는 repository에서만, ③ 지정 모듈은 `server-only` import. eslint(개발 피드백) + 구조 스캔 테스트(CI 가드) 이중.

## Files

- Modify: `eslint.config.mjs` — `src/modules/**`에 `no-restricted-imports`(reader만 허용) 블록 추가.
- Test: `tests/kernel/settings/boundaries.test.ts` — 구조 스캔 가드.

## Prep

- spec §9(경계 가드), entrypoint §SC-1. element 단위 boundaries는 `module→kernel` 전체를 허용하므로 reader-only 세부 규칙은 별도 필요.
- Node 20+ `readdirSync(dir, { recursive: true })` 사용(런타임 v24 확인됨).

## Deps

- Task 04(service/reader/index), Task 06(modules/integrations가 reader 사용 — 스캔 대상 존재).

## TDD steps

### 1. 가드 테스트 작성 — `tests/kernel/settings/boundaries.test.ts`

```ts
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

  it("SystemSetting 직접 write는 repository.ts에서만", () => {
    const offenders: string[] = [];
    const writeRe = /systemSetting\s*\.\s*(create|update|updateMany|upsert|delete|deleteMany)\b/;
    for (const file of filesUnder("src")) {
      if (file.replace(/\\/g, "/").endsWith("kernel/settings/repository.ts")) continue;
      if (writeRe.test(readFileSync(file, "utf8"))) offenders.push(file);
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
```

### 2. 실행 → PASS (정상 코드에서 통과하는 가드)

```bash
npm test -- boundaries
```

기대: 3 테스트 통과(task 01–06이 올바르면).

### 3. eslint 규칙 추가 — `eslint.config.mjs`

기존 `eslintConfig` 배열의 마지막 블록 뒤에 모듈 전용 블록을 추가한다(다른 블록은 불변):

```js
  {
    files: ["src/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        2,
        {
          patterns: [
            {
              group: [
                "@/kernel/settings",
                "@/kernel/settings/service",
                "@/kernel/settings/index",
                "@/kernel/settings/catalog",
                "@/kernel/settings/repository",
              ],
              message: "modules must import settings only via @/kernel/settings/reader",
            },
          ],
        },
      ],
    },
  },
```

`@/kernel/settings/reader`는 group에 없으므로 허용된다(다른 항목은 정확 매칭이라 reader를 잡지 않음).

### 4. lint → PASS

```bash
npm run lint
```

기대: 에러 0(modules/integrations는 reader만 쓰므로 위반 없음).

### 5. 가드가 실제로 잡는지 증명(위반 심기 → 되돌리기)

```bash
# (a) 구조 테스트 증명: 모듈에 금지 import를 임시로 넣는다
#     src/modules/integrations/status.ts 상단에 임시 추가:
#       import { CATALOG } from "@/kernel/settings/catalog";
npm test -- boundaries   # → "modules의 ... reader뿐" 테스트 FAIL 확인
npm run lint             # → no-restricted-imports 에러 확인
# (b) 임시 import 제거 후 원복
npm test -- boundaries   # → 다시 PASS
npm run lint             # → 다시 에러 0
```

(이 단계는 가드의 실효성 확인용 — 커밋하지 않는다.)

### 6. typecheck + 커밋

```bash
npm run typecheck && npm run lint
git add eslint.config.mjs tests/kernel/settings/boundaries.test.ts
git commit -m "Add settings boundary guards: reader-only, no direct write, server-only"
```

## Acceptance Criteria

- `npm test -- boundaries` → 3 PASS.
- `npm run lint` → 에러 0. 모듈에 금지 import를 심으면 lint·테스트 모두 FAIL(5단계로 증명).
- `npm run typecheck` → 에러 0.

## Cautions

- **5단계의 위반 심기 변경을 커밋하지 말 것. 이유:** 가드 실효성 확인용 임시 변경. 반드시 원복 후 커밋.
- **구조 스캔에서 `repository.ts`만 예외. 이유:** write 경로의 유일 소유자. 다른 곳에서 `systemSetting.*` write가 생기면 감사·concurrency 우회(§5.5).
- **eslint group에 `@/kernel/settings/reader`를 넣지 말 것. 이유:** reader는 모듈의 유일 허용 진입점.
- **테스트는 정적 파일 스캔이라 DB·빌드 불필요. 이유:** CI에서 빠르고 결정적으로 경계 회귀를 잡기 위함.
