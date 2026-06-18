import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// spec §9 필수 대비 게이트: 라이트 --color-ring이 background/page/card/input 표면 각각에
// 대해 WCAG 1.4.11(비텍스트 ≥3:1)을 충족해야 한다. 미달이면 이 테스트가 실패해 머지 차단.
// 수동 스모크로 면제 불가. ring 값을 향후 바꿔도 globals.css에서 읽어 자동 재검증된다.

const cssPath = fileURLToPath(new URL("../../src/app/globals.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");

// 라이트 @theme { ... } 블록만 추출(다크 블록의 동명 토큰과 분리). @theme에 중첩 중괄호 없음.
const themeBlock = css.match(/@theme\s*\{([^}]*)\}/)?.[1] ?? "";

function tokenHex(name: string): string {
  const m = themeBlock.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`@theme에서 --color-${name}의 6자리 hex를 찾지 못했습니다`);
  return m[1];
}

// sRGB 채널(0..255) → 선형값 (WCAG 정의)
function srgbToLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = srgbToLinear((n >> 16) & 0xff);
  const g = srgbToLinear((n >> 8) & 0xff);
  const b = srgbToLinear(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe("포커스 ring 대비 게이트 (WCAG 1.4.11 ≥ 3:1)", () => {
  const ring = tokenHex("ring");
  // background·card는 순백(oklch(1 0 0) = #ffffff) 유지 → 리터럴.
  // page·input은 §5에서 hex로 retint되므로 globals.css에서 직접 읽어 바인딩.
  const surfaces: Record<string, string> = {
    background: "#ffffff",
    card: "#ffffff",
    page: tokenHex("page"),
    input: tokenHex("input"),
  };

  for (const [name, hex] of Object.entries(surfaces)) {
    it(`ring ↔ ${name} 대비 ≥ 3:1`, () => {
      expect(contrast(ring, hex)).toBeGreaterThanOrEqual(3);
    });
  }
});
