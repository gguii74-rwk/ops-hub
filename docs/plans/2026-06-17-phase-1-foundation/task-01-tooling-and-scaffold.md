# Task 01 — 툴링·앱 스캐폴드·3계층 경계

목적: Next 16 + TS + ESLint(flat) + vitest를 세우고, `src/{kernel,modules,lib,app}` 3계층 디렉터리와 `eslint-plugin-boundaries` 규칙을 만들어 **경계 위반이 lint 에러로 잡히는 것을 증명**한다.

## Files

- Create: `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `src/kernel/.gitkeep`, `src/modules/.gitkeep`, `src/lib/.gitkeep`
- Create: `tests/sanity.test.ts`
- Modify: `package.json` (scripts.test, devDependencies)

## Prep

- §Shared Contracts **SC-1**(디렉터리·경계 표), **SC-10**(검증 명령).
- 현재 저장소엔 `tsconfig.json`/`next.config`/`src/`가 없다(설계 기준선). 이 task가 그 골격을 만든다.

## Deps

없음.

## Steps

### 1. 의존성 설치

```bash
npm install -D vitest eslint-plugin-boundaries@^4 @eslint/eslintrc
```

`next`/`react`/`eslint`/`eslint-config-next`/`typescript`는 이미 `package.json`에 있다(설치만). **`eslint-plugin-boundaries`는 `^4`로 핀**한다 — Step 5 config는 v4의 `boundaries/element-types`(`${from.X}` 캡처 매처) API를 쓴다. 핀하지 않으면 v5의 `boundaries/dependencies`(다른 문법)가 설치돼 config가 어긋난다.

### 2. `package.json`에 test 스크립트 추가

`scripts`에 다음 한 줄을 추가한다(기존 스크립트는 건드리지 않는다):

```json
"test": "vitest run",
```

### 3. `tsconfig.json` 생성

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### 4. `next.config.ts` 생성

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

### 5. `eslint.config.mjs` 생성 — 경계 규칙 포함

```js
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import boundaries from "eslint-plugin-boundaries";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "kernel", pattern: "src/kernel", mode: "folder" },
        { type: "module", pattern: "src/modules/*", mode: "folder", capture: ["module"] },
        { type: "lib", pattern: "src/lib", mode: "folder" },
        { type: "app", pattern: "src/app", mode: "folder" },
        // 미들웨어는 src 루트 파일이라 별도 분류(edge). 미분류면 no-unknown이 잡는다.
        { type: "edge", pattern: "src/middleware.ts", mode: "file" },
      ],
    },
    rules: {
      // src 안의 모든 파일이 한 element로 분류돼야 한다(분류 누락 = 경계 미적용 사각지대 차단).
      "boundaries/no-unknown": 2,
      "boundaries/element-types": [
        2,
        {
          default: "disallow",
          rules: [
            { from: ["lib"], allow: ["lib"] },
            { from: ["kernel"], allow: ["kernel", "lib"] },
            { from: ["module"], allow: ["kernel", "lib", ["module", { module: "${from.module}" }]] },
            { from: ["app"], allow: ["app", "kernel", "lib", "module"] },
            // 미들웨어(edge)는 lib만 — 단, lib/auth/index(node) import 금지는 element 단위로는
            // 강제 못 한다(SC-7). 그 한 줄은 authConfig 분리 + Next 빌드가 막는다.
            { from: ["edge"], allow: ["lib"] },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
```

### 6. `vitest.config.ts` 생성

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
```

### 7. 앱 셸 최소 파일

`src/app/globals.css`:

```css
:root {
  color-scheme: light;
  --bg: #ffffff;
  --fg: #111827;
  --muted: #6b7280;
  --border: #e5e7eb;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--fg);
  font-family:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Apple SD Gothic Neo",
    "Malgun Gothic", sans-serif;
}
```

`src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ops-hub",
  description: "내부 업무 운영 허브",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx` — 루트는 대시보드로 보낸다:

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
```

### 8. 계층 디렉터리 표식

빈 디렉터리를 git이 추적하도록 표식을 둔다. 각각 빈 파일:

- `src/kernel/.gitkeep`
- `src/modules/.gitkeep`
- `src/lib/.gitkeep`

### 9. vitest smoke test

`tests/sanity.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("sanity", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

### 10. 검증 — 통과 확인

```bash
npm run typecheck   # 에러 0
npm run lint        # 에러 0 (clean)
npm test            # 1 passed
npm run build       # success ('/' → /dashboard redirect 빌드)
```

`npm run build`가 `/dashboard` 미존재로 경고할 수 있으나 빌드 자체는 성공해야 한다(페이지는 task-10에서 생성). 빌드가 **실패**하면 멈추고 원인을 본다.

### 11. 검증 — 경계 규칙이 실제로 막는지 증명(필수 게이트)

임시 모듈 2개를 만들어 **모듈 간 import**가 막히고 **모듈 내 import**는 허용되는지 확인한다.

```bash
mkdir -p src/modules/alpha src/modules/beta
printf 'export const A = 1;\n' > src/modules/alpha/index.ts
printf "import { A } from '@/modules/alpha';\nexport const B = A;\n" > src/modules/beta/index.ts
npm run lint
```

기대: `beta/index.ts`에서 `boundaries/element-types` 에러(`module beta`가 `module alpha`를 import). 에러가 **나면** 규칙이 동작한다.

이어서 같은 모듈 내 import는 통과하는지 확인:

```bash
printf 'export const HELPER = 2;\n' > src/modules/alpha/helper.ts
printf "import { HELPER } from '@/modules/alpha/helper';\nexport const A = HELPER;\n" > src/modules/alpha/index.ts
npm run lint
```

기대: `alpha` 내부 import는 에러 없음(다른 잔여 에러도 없어야 함).

이어서 **kernel → module 차단**(SC-1 핵심 규칙)도 증명한다:

```bash
printf "import { A } from '@/modules/alpha';\nexport const K = A;\n" > src/kernel/probe.ts
npm run lint
```

기대: `kernel`이 `module`을 import하므로 `boundaries/element-types` 에러. 에러가 나야 "커널은 모듈을 모른다"가 강제된다.

확인 후 임시 파일·디렉터리 제거:

```bash
rm -rf src/modules/alpha src/modules/beta src/kernel/probe.ts
```

### 12. 커밋

```bash
git add -A
git commit -m "Scaffold Next app skeleton with 3-layer boundary lint and vitest"
```

## Acceptance Criteria

- `npm run typecheck` → 에러 0.
- `npm run lint` → 스캐폴드 상태에서 에러 0.
- `npm test` → `1 passed`.
- `npm run build` → 성공.
- Step 11에서 ① 모듈 간 import와 ② kernel→module import가 각각 `boundaries/element-types` 에러를 일으키고, 모듈 내 import는 에러가 없다.
- `boundaries/no-unknown`이 켜져 있어 `src/` 안 미분류 파일이 없다(미들웨어 포함 전부 element로 분류됨).
- 임시 검증 파일이 모두 제거되어 작업 트리에 `src/modules/alpha|beta`·`src/kernel/probe.ts`가 없다.

## Cautions

- **Don't `next/typescript`가 해석되지 않는다고 즉시 우회하지 마라. Reason:** eslint-config-next 16은 flat 공유 설정을 제공한다. 만약 `compat.extends("next/typescript")`가 실패하면 그 한 항목만 빼고 `compat.extends("next/core-web-vitals")`만 둔다(경계 규칙 블록은 그대로).
- **Don't `eslint-plugin-boundaries`를 핀 없이 설치하지 마라. Reason:** v5는 규칙명이 `boundaries/dependencies`로 바뀌고 템플릿이 `{{ from.captured.module }}`다. Step 1에서 `^4`로 핀했으므로 위 config(element-types)가 정답이다. 만약 v5+를 써야 한다면(핀 해제 시) Step 11에서 위반이 **에러를 내지 않을 것**이고, 그때만 아래 v5 형태로 교체하고 Step 11을 다시 돌린다:
  ```js
  "boundaries/dependencies": [
    2,
    {
      default: "disallow",
      rules: [
        { from: { type: "lib" }, allow: { to: { type: "lib" } } },
        { from: { type: "kernel" }, allow: { to: { type: ["kernel", "lib"] } } },
        {
          from: { type: "module" },
          allow: {
            to: [
              { type: ["kernel", "lib"] },
              { type: "module", captured: { module: "{{ from.captured.module }}" } },
            ],
          },
        },
        { from: { type: "app" }, allow: { to: { type: ["app", "kernel", "lib", "module"] } } },
      ],
    },
  ],
  ```
- **Don't `tailwind`나 디자인 시스템을 도입하지 마라. Reason:** Phase 1은 골격이다. placeholder 페이지는 plain CSS로 충분하고, UI 시스템 결정은 실제 화면 플랜으로 미룬다.
