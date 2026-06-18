# task-01 — 색 토큰 retint + 브랜드 토큰 + 대비 게이트

**목적:** `globals.css`의 라이트/다크 시맨틱 색 토큰을 브랜드 팔레트로 retint하고, 신규 브랜드 토큰 6종을 추가한다. 동시에 포커스 ring 대비를 강제하는 vitest 게이트를 도입해 spec §9의 "면제 불가" 요건을 자동화한다.

## Files

- **Create:** `tests/app/globals-contrast.test.ts` — 포커스 ring 대비 게이트
- **Modify:** `src/app/globals.css` — 라이트 `@theme` 색 토큰 retint + 브랜드 토큰 6종, 다크 `[data-theme="dark"]` 블록 retint

## Prep

- spec 읽기: §4(토큰 전략), §5(정확한 토큰 값), §8(접근성)
- 엔트리포인트 §Shared Contracts의 "canonical 색 값", "대비 게이트"
- 현재 `src/app/globals.css`(라이트 `@theme` + 다크 블록 oklch/hex 혼재). 폰트(`--font-display`)는 **이 태스크에서 건드리지 않는다**(task-02). `--font-sans` 블록은 그대로 둔다.

## Deps

없음.

## Steps (TDD — 대비 게이트만 자동 테스트)

### 1. (RED) 대비 게이트 테스트 작성

`tests/app/globals-contrast.test.ts` 생성:

```ts
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
```

### 2. (RED 확인) 테스트 실행 — FAIL 기대

```bash
npm test -- globals-contrast
```

기대: **FAIL**. 현재 `globals.css`의 `--color-ring`/`--color-page`/`--color-input`은 oklch라 `tokenHex`가 6자리 hex를 못 찾고 throw → 테스트 에러(빨강). 이것이 의도된 RED다.

### 3. (GREEN) globals.css 라이트 `@theme` 색 토큰 retint + 브랜드 토큰 추가

`src/app/globals.css`의 `@theme` 블록에서 **변경되는 9개 색 토큰만** 아래 hex로 교체한다. 나머지 색 토큰(`background` `foreground` `card(+fg)` `popover(+fg)` `primary(+fg)` `secondary-foreground` `destructive(+fg)`)과 `--radius-*`·`--font-sans`는 **건드리지 않는다**.

교체 후 `@theme`의 색 토큰 영역은 다음과 같아야 한다(변경 라인만 hex, 유지 라인은 현재 oklch 그대로):

```css
@theme {
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.145 0 0);
  --color-card: oklch(1 0 0);
  --color-card-foreground: oklch(0.145 0 0);
  --color-popover: oklch(1 0 0);
  --color-popover-foreground: oklch(0.145 0 0);
  --color-primary: oklch(0.205 0 0);
  --color-primary-foreground: oklch(0.985 0 0);
  --color-secondary: #F1EEF8;
  --color-secondary-foreground: oklch(0.205 0 0);
  --color-muted: #F1EEF8;
  --color-muted-foreground: #6B6878;
  --color-accent: #ECE3FF;
  --color-accent-foreground: #5B3D9E;
  --color-destructive: oklch(0.577 0.245 27.325);
  --color-destructive-foreground: oklch(0.985 0 0);
  --color-border: #E9E5F2;
  --color-input: #E9E5F2;
  --color-ring: #7C3AED;
  --color-page: #F6F3FC;

  /* 신규 브랜드 토큰 (라이트·다크 공통 hue). 향후 도메인 화면이 소비.
     chart-cyan·point-lime은 매우 밝아 텍스트색으로 쓰지 않고 칩/소프트 배경으로만 쓴다. */
  --color-brand: #BA8DFF;
  --color-brand-foreground: #2A1A4A;
  --color-brand-2: #FBC6F2;
  --color-brand-2-foreground: #7A2E66;
  --color-chart-cyan: #24D0FE;
  --color-point-lime: #EAFF00;

  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;

  --font-sans:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Apple SD Gothic Neo",
    "Malgun Gothic", sans-serif;
}
```

### 4. (GREEN) globals.css 다크 블록 retint

`@layer base { [data-theme="dark"] { ... } }`의 색 토큰을 spec §5 다크 표대로 교체한다. `--color-destructive`(`#ef4444`)만 유지, 나머지는 모두 신규 hex. 브랜드 토큰은 다크 블록에 **재정의하지 않는다**(`@theme` 정의가 다크에서도 동일 hex로 유효).

교체 후 다크 블록 전체:

```css
@layer base {
  [data-theme="dark"] {
    --color-background: #0C0B11;
    --color-foreground: #F4F2F8;
    --color-card: #16141C;
    --color-card-foreground: #F4F2F8;
    --color-popover: #16141C;
    --color-popover-foreground: #F4F2F8;
    --color-primary: #F4F2F8;
    --color-primary-foreground: #16141C;
    --color-secondary: #221F2B;
    --color-secondary-foreground: #F4F2F8;
    --color-muted: #221F2B;
    --color-muted-foreground: #9A95A8;
    --color-accent: #241E33;
    --color-accent-foreground: #D9C9FF;
    --color-destructive: #ef4444;
    --color-destructive-foreground: #F4F2F8;
    --color-border: #2A2733;
    --color-input: #2A2733;
    --color-ring: #C9A8FF;
    --color-page: #0C0B11;
  }
}
```

### 5. (GREEN 확인) 대비 게이트 통과

```bash
npm test -- globals-contrast
```

기대: **PASS**. 4개 표면 모두 ≥3:1(`#7C3AED` 기준 background/card ≈5.7:1, page ≈5.2:1, input ≈4.6:1).

### 6. 커밋

```bash
git add src/app/globals.css tests/app/globals-contrast.test.ts
git commit -m "Retint semantic tokens to brand palette; add brand tokens and ring contrast gate"
```

## Acceptance Criteria

```bash
npm test            # 대비 게이트 PASS + 기존 92개 회귀 없음 (총 96개 통과)
npm run typecheck   # 에러 없음
npm run lint        # 에러 없음(boundaries 포함)
```

- `globals.css` 라이트 `@theme`에 `--color-ring: #7C3AED;` 등 9개 변경 토큰 + 브랜드 6종이 존재.
- 다크 블록이 spec §5 다크 표대로 retint됨, `--color-destructive: #ef4444` 유지.
- `tests/app/globals-contrast.test.ts`가 4개 표면 대비를 단언하며 통과.

## Cautions

- **유지 토큰을 retint하지 말 것.** 이유: 블랙 CTA(`primary`)·레드(`destructive`)·순백 표면(`background`/`card`/`popover`)은 spec의 "틴티드 하이브리드" 설계상 의도적으로 보존된다(spec §2·§4). page만 옅은 라벤더 틴트.
- **브랜드 토큰을 다크 블록에 재정의하지 말 것.** 이유: 파스텔 4색은 라이트·다크 공통 hue로 `@theme`에 한 번만 둔다(밝은 액센트로 다크 위에서 선명). 중복 정의는 드리프트 위험.
- **이 태스크에서 `--font-display`를 추가하지 말 것.** 이유: 폰트는 task-02 소관(layout.tsx의 `--font-playfair` 로드와 한 묶음). 여기서 추가하면 `var(--font-playfair)` 미정의 상태가 생긴다.
- **대비 테스트의 surface 리터럴(`#ffffff`)을 임의로 바꾸지 말 것.** 이유: `background`/`card`는 순백 유지가 전제다. 향후 이 표면을 틴트하면 그때 리터럴을 실제 값으로 갱신해야 게이트가 정확해진다.
