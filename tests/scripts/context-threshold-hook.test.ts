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
