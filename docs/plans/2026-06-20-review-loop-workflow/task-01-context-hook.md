# Task 01 — 컨텍스트 임계 훅 스크립트 + 테스트

목적: transcript의 마지막 assistant `usage`로 컨텍스트 사용량을 계산하고, 임계(기본 40%)를 넘으면 핸드오프+`/clear`를 1회 넛지하는 Stop 훅 스크립트를 TDD로 만든다.

## Files

- Create: `scripts/context-threshold-hook.mjs`
- Test: `tests/scripts/context-threshold-hook.test.ts`

## Prep

- spec §4.2(훅 동작), entrypoint §SC-4(상수·계약), §SC-5(핸드오프).
- 순수 함수 2개(`computeContextUsage`, `decideNudge`)를 export해 테스트하고, `main()`은 직접 실행 시에만 동작(테스트 import 시 미실행).

## Deps

없음.

## TDD steps

### 1) 실패 테스트 작성 — `tests/scripts/context-threshold-hook.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  computeContextUsage,
  decideNudge,
} from "../../scripts/context-threshold-hook.mjs";

function jsonl(...objs: unknown[]) {
  return objs.map((o) => JSON.stringify(o)).join("\n");
}

describe("computeContextUsage", () => {
  it("마지막 assistant usage를 합산하고 [1m] 모델은 1M 한도를 쓴다", () => {
    const text = jsonl(
      { type: "user", message: { role: "user" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-opus-4-8[1m]",
          usage: {
            input_tokens: 100,
            cache_read_input_tokens: 300_000,
            cache_creation_input_tokens: 100_000,
            output_tokens: 50,
          },
        },
      },
    );
    const r = computeContextUsage(text);
    expect(r).not.toBeNull();
    expect(r!.used).toBe(400_100);
    expect(r!.limit).toBe(1_000_000);
    expect(r!.ratio).toBeCloseTo(0.4001, 4);
  });

  it("[1m]이 아니면 200k 한도를 쓴다", () => {
    const text = jsonl({
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        usage: { input_tokens: 100_000 },
      },
    });
    const r = computeContextUsage(text);
    expect(r!.limit).toBe(200_000);
    expect(r!.ratio).toBeCloseTo(0.5, 5);
  });

  it("가장 마지막 assistant usage만 사용한다", () => {
    const text = jsonl(
      {
        type: "assistant",
        message: { role: "assistant", model: "x[1m]", usage: { input_tokens: 1 } },
      },
      {
        type: "assistant",
        message: { role: "assistant", model: "x[1m]", usage: { input_tokens: 500_000 } },
      },
    );
    expect(computeContextUsage(text)!.used).toBe(500_000);
  });

  it("env OPS_HUB_CTX_LIMIT override를 적용한다", () => {
    const text = jsonl({
      type: "assistant",
      message: { role: "assistant", model: "x[1m]", usage: { input_tokens: 50_000 } },
    });
    const r = computeContextUsage(text, { OPS_HUB_CTX_LIMIT: "100000" });
    expect(r!.limit).toBe(100_000);
    expect(r!.ratio).toBeCloseTo(0.5, 5);
  });

  it("usage 있는 assistant 메시지가 없으면 null", () => {
    const text = jsonl({ type: "user", message: { role: "user" } });
    expect(computeContextUsage(text)).toBeNull();
  });

  it("깨진 JSON 라인은 건너뛴다", () => {
    const text = [
      "not json {",
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", model: "a", usage: { input_tokens: 10_000 } },
      }),
    ].join("\n");
    expect(computeContextUsage(text)!.used).toBe(10_000);
  });
});

describe("decideNudge", () => {
  const base = { ratio: 0.5, threshold: 0.4, stopHookActive: false, alreadyNudged: false };

  it("임계 초과 + 미넛지 + stop_hook_active 아님 → 넛지", () => {
    const d = decideNudge(base);
    expect(d.shouldNudge).toBe(true);
    expect(d.reason).toContain("/clear");
  });

  it("stop_hook_active면 넛지 안 함(무한 루프 방지)", () => {
    expect(decideNudge({ ...base, stopHookActive: true }).shouldNudge).toBe(false);
  });

  it("이미 넛지했으면 안 함(중복 방지)", () => {
    expect(decideNudge({ ...base, alreadyNudged: true }).shouldNudge).toBe(false);
  });

  it("임계 미만이면 안 함", () => {
    expect(decideNudge({ ...base, ratio: 0.39 }).shouldNudge).toBe(false);
  });

  it("임계 정확히 도달하면 넛지(>=)", () => {
    expect(decideNudge({ ...base, ratio: 0.4 }).shouldNudge).toBe(true);
  });
});
```

### 2) 테스트 실행 — FAIL 기대

```bash
npm test -- tests/scripts/context-threshold-hook.test.ts
```
기대: 모듈을 찾을 수 없어 실패(아직 스크립트 없음).

### 3) 최소 구현 — `scripts/context-threshold-hook.mjs`

```js
#!/usr/bin/env node
// 컨텍스트 임계 Stop 훅: transcript 마지막 assistant usage로 컨텍스트 사용량을 계산하고,
// 임계(기본 40%) 초과 시 핸드오프 작성 + /clear 안내를 1회 넛지한다.
// Stop 훅 계약: stdin JSON 입력, 넛지 시 {"decision":"block","reason":...} 출력, 그 외 exit 0.
// 자가 /clear는 불가하므로 실제 초기화는 사용자가 한다(설계 §2).

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_LIMIT_1M = 1_000_000;
const DEFAULT_LIMIT_STD = 200_000;
const DEFAULT_THRESHOLD = 0.4;

// transcript JSONL 텍스트에서 마지막 assistant usage를 찾아 컨텍스트 사용량을 계산한다.
export function computeContextUsage(transcriptText, env = {}) {
  const lines = String(transcriptText).split(/\r?\n/);
  let last = null;
  for (const line of lines) {
    if (line.trim() === "") continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = obj && obj.message;
    if (msg && msg.role === "assistant" && msg.usage) last = msg;
  }
  if (!last) return null;
  const u = last.usage || {};
  const used =
    (u.input_tokens || 0) +
    (u.cache_read_input_tokens || 0) +
    (u.cache_creation_input_tokens || 0);
  const model = last.model || "";
  const envLimit = Number(env.OPS_HUB_CTX_LIMIT);
  const limit =
    Number.isFinite(envLimit) && envLimit > 0
      ? envLimit
      : /\[1m\]/i.test(model)
        ? DEFAULT_LIMIT_1M
        : DEFAULT_LIMIT_STD;
  return { used, limit, ratio: used / limit, model };
}

// 넛지 여부 결정(순수 함수).
export function decideNudge({ ratio, threshold, stopHookActive, alreadyNudged }) {
  if (stopHookActive) return { shouldNudge: false, reason: "" };
  if (alreadyNudged) return { shouldNudge: false, reason: "" };
  if (!(ratio >= threshold)) return { shouldNudge: false, reason: "" };
  const pct = Math.round(ratio * 100);
  const thr = Math.round(threshold * 100);
  return {
    shouldNudge: true,
    reason:
      `컨텍스트 사용량이 약 ${pct}%로 임계(${thr}%)를 넘었습니다. 멈추기 전에: ` +
      `(1) .remember/remember.md에 현재 작업 상태를 핸드오프로 작성하세요 ` +
      `(review-loop 중이면 phase·iteration·base·미해결 finding 포함). ` +
      `(2) 사용자에게 "이어서 진행하려면 /clear 후 동일 작업(또는 /review-loop --resume)을 다시 호출하세요"라고 안내하세요. ` +
      `자가 /clear는 불가하므로 실제 초기화는 사용자가 합니다.`,
  };
}

function flagPath(sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(tmpdir(), `ops-hub-ctx-nudge-${safe}`);
}

function resolveThreshold() {
  const t = Number(process.env.OPS_HUB_CTX_THRESHOLD);
  return Number.isFinite(t) && t > 0 && t < 1 ? t : DEFAULT_THRESHOLD;
}

function main() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    /* stdin 없음 */
  }
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    input = {};
  }

  const stopHookActive = input.stop_hook_active === true;
  const transcriptPath = input.transcript_path;
  const sessionId = input.session_id;

  if (stopHookActive || !transcriptPath || !existsSync(transcriptPath)) {
    process.exit(0);
  }

  let usage;
  try {
    usage = computeContextUsage(readFileSync(transcriptPath, "utf8"), process.env);
  } catch {
    process.exit(0);
  }
  if (!usage) process.exit(0);

  const fp = flagPath(sessionId);
  const decision = decideNudge({
    ratio: usage.ratio,
    threshold: resolveThreshold(),
    stopHookActive,
    alreadyNudged: existsSync(fp),
  });

  if (!decision.shouldNudge) process.exit(0);

  try {
    writeFileSync(fp, "1");
  } catch {
    /* best effort */
  }
  process.stdout.write(JSON.stringify({ decision: "block", reason: decision.reason }));
  process.exit(0);
}

// 직접 실행 시에만 main() (vitest import 시에는 실행되지 않음)
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
```

### 4) 테스트 실행 — PASS 기대

```bash
npm test -- tests/scripts/context-threshold-hook.test.ts
```
기대: 11개 테스트 통과.

### 5) 직접 실행 스모크(수동) — 넛지 발생 확인

```bash
# [1m] 모델 + 50% 사용 transcript를 임시로 만들어 직접 실행
node -e 'const fs=require("fs");fs.writeFileSync(process.env.TMPDIR? process.env.TMPDIR+"/t.jsonl":"./t.jsonl", JSON.stringify({type:"assistant",message:{role:"assistant",model:"claude-opus-4-8[1m]",usage:{input_tokens:500000}}}))'
echo '{"transcript_path":"./t.jsonl","session_id":"smoke","stop_hook_active":false}' | node scripts/context-threshold-hook.mjs
```
기대: `{"decision":"block","reason":"컨텍스트 사용량이 약 50%..."}` 출력. (정리: `rm -f t.jsonl` 및 tmp 플래그)

### 6) 커밋

```bash
git add scripts/context-threshold-hook.mjs tests/scripts/context-threshold-hook.test.ts
git commit -m "feat(workflow): 컨텍스트 임계 Stop 훅 스크립트(transcript usage 40% 넛지) + 테스트"
```

## Acceptance Criteria

- `npm test -- tests/scripts/context-threshold-hook.test.ts` → 11 passed.
- `npm test` → 기존 스위트 회귀 없음(전부 통과).
- `npm run typecheck` → 에러 없음(테스트가 `.mjs` import해도 allowJs로 통과).
- 5) 스모크에서 `decision:block` JSON 출력 확인.

## Cautions

- **`main()`을 무조건 호출하지 말 것. 이유: vitest가 모듈을 import할 때 main()이 돌면 stdin 대기/exit로 테스트가 깨진다.** 반드시 `invokedDirectly` 가드 유지.
- **넛지를 `decision:block`이 아닌 단순 stdout 텍스트로 내지 말 것. 이유: Stop 훅에서 비차단 출력은 모델이 행동으로 받지 않아 핸드오프가 트리거되지 않는다.** 단 무한 차단을 막으려 `stop_hook_active`/플래그 가드는 필수.
- **토큰 한도를 200k로 하드코딩하지 말 것. 이유: 사용자는 `[1m]` 모델이라 40%가 400k다.** 모델 id 판별 + env override 유지.
