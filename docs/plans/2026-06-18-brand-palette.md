# 브랜드 팔레트 패스 — 구현 계획 (엔트리포인트)

- **Feature:** Brand Palette Pass (중립 토큰 → 비비드 파스텔 브랜드 재테마 + Playfair + 활성 nav pill + login/대시보드 리터치)
- **Goal:** 디자인 시스템 기반의 중립 그레이스케일 시맨틱 토큰을 **틴티드 하이브리드 브랜드 팔레트**로 재테마하고, Playfair 워드마크·활성 nav pill·샘플 지표 카드로 브랜드를 가시화한다.
- **Architecture:** 프리미티브는 이미 시맨틱 토큰만 소비하므로 `globals.css @theme` 값을 바꾸면 전 화면에 자동 전파된다. 추가 구조물은 활성 pill용 client `AppNav` 하나뿐. 순수 프레젠테이션 변경(로직·권한·스키마 무변경).
- **Tech Stack:** Next 16(App Router) · React 19 · Tailwind v4 CSS-first(`@theme`) · `next/font/google`(Playfair Display, self-host) · class-variance-authority/cn(기존) · vitest.
- **Spec:** `docs/specs/2026-06-18-brand-palette-design.md`
- **선행 완료:** Design System Foundation(`docs/plans/2026-06-18-design-system-foundation.md`) — 토큰 19개 + 프리미티브 7종 + 앱 셸·테마·토스트가 머지됨.

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-18-brand-palette/task-NN-<slug>.md`). Task bodies (Files, steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

## 검증 정책 (이 plan의 TDD 적용 범위)

UI/CSS는 자동 테스트 인프라를 **이번에도 도입하지 않는다**(spec §9, Phase 1·2·디자인시스템 정책 동일). 따라서 대부분 태스크의 검증 게이트는 **`npm run typecheck` · `npm run lint`(boundaries 포함) · `npm run build`** + 명시된 **수동 스모크 + Playwright 스크린샷**이다.

**단 하나의 예외이자 필수 게이트(spec §9): 포커스 ring 대비.** 이것은 순수 수치 계산이라 vitest로 TDD하고, `npm test`에 상주시켜 **수동 스모크로 면제 불가**하게 만든다(task-01). 라이트 `--color-ring`이 `background`·`page`·`card`·`input` 표면 각각에 대해 WCAG 1.4.11(비텍스트 ≥3:1)을 충족하지 못하면 테스트가 빨개져 머지가 차단된다. 기존 92개 테스트는 전 태스크에서 회귀가 없어야 한다(`npm test`).

## Shared Contracts

엔트리포인트는 모든 태스크와 함께 읽힌다. 2개 이상 태스크가 참조하는 토큰 값·시그니처·게이트는 여기 한 번만 둔다(태스크 파일은 이를 재인라인하지 않고 "엔트리포인트 §Shared Contracts"로 가리킨다).

### canonical 색 값 (spec §5의 진실원 — hex)

브랜드 파스텔은 hex가 진실원이다. 라이트에서 **변경되는** 토큰은 본 plan에서 **hex로 적는다**(spec §5가 hex를 baseline으로 제시; oklch 변환은 선택이나 대비 게이트의 hex 추출을 단순화하기 위해 이 plan은 hex로 통일). **변경되지 않는** 토큰은 현재 oklch 값을 그대로 둔다.

라이트 `@theme` — 변경되는 토큰(task-01):

| 토큰 | 신규 hex |
| --- | --- |
| `--color-page` | `#F6F3FC` |
| `--color-ring` | `#7C3AED` |
| `--color-accent` | `#ECE3FF` |
| `--color-accent-foreground` | `#5B3D9E` |
| `--color-secondary` | `#F1EEF8` |
| `--color-muted` | `#F1EEF8` |
| `--color-muted-foreground` | `#6B6878` |
| `--color-border` | `#E9E5F2` |
| `--color-input` | `#E9E5F2` |

라이트 유지(손대지 않음): `background` `foreground` `card(+fg)` `popover(+fg)` `primary(+fg)` `secondary-foreground` `destructive(+fg)`.

신규 브랜드 토큰 — 라이트·다크 공통 hue(task-01):

| 토큰 | 값 |
| --- | --- |
| `--color-brand` | `#BA8DFF` |
| `--color-brand-foreground` | `#2A1A4A` |
| `--color-brand-2` | `#FBC6F2` |
| `--color-brand-2-foreground` | `#7A2E66` |
| `--color-chart-cyan` | `#24D0FE` |
| `--color-point-lime` | `#EAFF00` |

다크 `[data-theme="dark"]` — 변경되는 토큰(task-01):

| 토큰 | 신규 | | 토큰 | 신규 |
| --- | --- | --- | --- | --- |
| `--color-background` | `#0C0B11` | | `--color-accent` | `#241E33` |
| `--color-foreground` | `#F4F2F8` | | `--color-accent-foreground` | `#D9C9FF` |
| `--color-card` | `#16141C` | | `--color-border` | `#2A2733` |
| `--color-card-foreground` | `#F4F2F8` | | `--color-input` | `#2A2733` |
| `--color-popover` | `#16141C` | | `--color-ring` | `#C9A8FF` |
| `--color-popover-foreground` | `#F4F2F8` | | `--color-page` | `#0C0B11` |
| `--color-primary` | `#F4F2F8` | | `--color-destructive-foreground` | `#F4F2F8` |
| `--color-primary-foreground` | `#16141C` | | `--color-secondary` | `#221F2B` |
| `--color-muted` | `#221F2B` | | `--color-secondary-foreground` | `#F4F2F8` |
| `--color-muted-foreground` | `#9A95A8` | | | |

다크 유지: `--color-destructive`(`#ef4444`). 브랜드 4색은 다크에서도 동일 hex(`@theme`에 한 번만 정의, 다크 블록에 재정의 없음).

### 폰트 (task-02)

- `src/app/layout.tsx`에서 `next/font/google`의 `Playfair_Display`를 로드: `weight: ["500","600"]`, `style: ["normal","italic"]`, `subsets: ["latin"]`, `variable: "--font-playfair"`, `display: "swap"`. `<html>`에 `playfair.variable` className 추가. body `font-sans` 유지.
- `globals.css @theme`에 `--font-display: var(--font-playfair), Georgia, "Times New Roman", serif;` 추가 → Tailwind v4가 `font-display` 유틸 노출(기존 `--font-sans` → `.font-sans` 와 동일 메커니즘).
- 소비 유틸: `font-display`. 적용처(의도적): 사이드바 워드마크, login 워드마크, 대시보드 샘플 카드 **숫자**. **한글 헤딩·본문에는 쓰지 않는다**(Playfair에 한글 글리프 없음).

### 소프트 배경 패턴

파스텔 소프트 배경은 별도 토큰 없이 opacity 유틸로 만든다: `bg-brand/15`, `bg-chart-cyan/15`, `bg-point-lime/25` 등. 기존 `button` destructive variant(`bg-destructive/10`)와 동일 패턴. **파스텔은 fill/액센트로만, 그 위 텍스트는 항상 다크**(`text-foreground` 또는 딥 변형) — spec §8.

### `AppNav` 시그니처 (task-03에서 생성: `src/app/(app)/app-nav.tsx`, `"use client"`)

```tsx
type NavItem = { key: string; label: string; href: string | null };
export function AppNav({ items }: { items: NavItem[] }): JSX.Element
```

- 프롭 타입은 `app-nav.tsx`에 **로컬 정의**한다. `@/kernel/navigation`의 `NavNode`를 import하지 않는다(이유: kernel 모듈은 `@/lib/prisma`를 끌고 오는 server-only 모듈 — client 번들 오염 위험 회피. `NavNode`와 구조 동일이라 `(app)/layout.tsx`가 넘기는 `nav: NavNode[]`는 그대로 호환).
- `usePathname()`으로 활성 판정: `item.href != null && (pathname === item.href || pathname.startsWith(item.href + "/"))`.
- 활성 = 라벤더 pill `bg-accent text-accent-foreground font-medium` + `aria-current="page"`. 비활성 = `text-muted-foreground hover:bg-muted hover:text-foreground`. 둘 다 `rounded-full px-3 py-1.5`.
- 경계: `app-nav.tsx`는 `src/app`(=app element)이라 `app → ui/lib` 허용 규칙 안에 있고, `next/link`·`next/navigation`은 외부 모듈이라 boundaries 미적용 → **eslint.config 변경 불필요**. client colocate 선례: `src/app/(app)/admin/settings/settings-editor.tsx`.

### 대비 게이트 (task-01에서 생성: `tests/app/globals-contrast.test.ts`)

`npm test`에 상주하는 필수 게이트. `src/app/globals.css`의 라이트 `@theme` 블록에서 `--color-ring`(+ `page`·`input`)을 hex로 읽어 WCAG 상대 휘도 기반 대비를 계산하고, `background`(`#ffffff`)·`page`·`card`(`#ffffff`)·`input` 각 표면에 대해 **≥3:1**을 단언한다. 전체 코드는 task-01에 인라인. 향후 `ring` 값을 바꿔도 이 게이트가 자동 적용된다.

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 색 토큰 retint + 브랜드 토큰 + 대비 게이트 | [ ] | [task-01](2026-06-18-brand-palette/task-01-color-tokens.md) | — | |
| 02 | 타이포: --font-display + Playfair next/font | [ ] | [task-02](2026-06-18-brand-palette/task-02-typography.md) | 01 | |
| 03 | AppNav client + 활성 pill + 워드마크 | [ ] | [task-03](2026-06-18-brand-palette/task-03-app-nav.md) | 01, 02 | |
| 04 | login 리터치 (워드마크 + 브랜드 액센트) | [ ] | [task-04](2026-06-18-brand-palette/task-04-login.md) | 01, 02 | |
| 05 | dashboard 샘플 지표 카드 + 최종 검증 | [ ] | [task-05](2026-06-18-brand-palette/task-05-dashboard-final.md) | 01, 02 | |
