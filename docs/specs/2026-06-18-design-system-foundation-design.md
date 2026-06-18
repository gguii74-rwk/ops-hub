# 디자인 시스템 기반(Design System Foundation) 설계

작성일: 2026-06-18
상태: 설계 확정(구현 계획 대기)

## 1. 배경과 목적

Phase 1·2는 권한·데이터 경계·쓰기 안전성에 집중하고 UI를 의도적으로 최소화했다. 그 결과 현재 화면은 전부 인라인 `style={{...}}`로 그려지고, `globals.css`에는 색 4개(`--bg/--fg/--muted/--border`)와 폰트 스택만 있다. 공통 컴포넌트·디자인 토큰·앱 셸이 없다.

이 상태로 Phase 3+의 도메인 화면(leave/workflows/calendar/admin)을 인라인 스타일로 쌓으면, 나중에 디자인을 입힐 때 화면 수만큼 수작업 교체가 필요해진다(회귀 위험이 큰 대규모 리팩터링). 반대로 모든 화면이 **공통 토큰 + 프리미티브**를 거치게 해두면, 이후 리스킨이 토큰/프리미티브 교체로 끝난다.

목적: 도메인 화면을 본격적으로 쌓기 전에 **얇은 디자인 표준**(토큰 + 프리미티브 + 앱 셸)을 한 번 깔고, 그것으로 기존 화면(login·앱 셸·settings)을 마이그레이션해 "살아있는 예시"로 검증한다. 화려한 비주얼 디자인(브랜드·정교한 컴포넌트 변형 등)은 이번 범위가 아니며, 토큰·프리미티브를 통해 나중에 한 곳에서 바꿀 수 있게 하는 것이 핵심이다.

## 2. 핵심 결정 요약

| 결정 | 선택 | 근거 |
| --- | --- | --- |
| 스타일링 방식 | **Tailwind v4 + 선택적 Base UI 계승** | day-sync가 동일 스택을 검증해 사용 중. workflows UI 포팅 시 클래스 이식이 매끄럽고, 이미 가져온 `cva`/`clsx`/`lucide`와 정합. |
| 작업 스코프 | **표준 + 기존 화면 마이그레이션** | 화면이 5개뿐인 지금이 마이그레이션 비용 최소. 표준을 실제 화면에 태워 검증. |
| 이식 범위 | **핵심만 선별 이식** | ADR-0001 "POC 통째 복사 금지, 검증된 동작만 의도적 포팅" 원칙과 정합. |
| 테마 토글 + 토스트 | **둘 다 포함** | day-sync에서 거의 그대로 이식 가능, UX 완성도 대비 비용 작음. |

day-sync는 이미 shadcn/ui 스타일(Base UI 기반) 디자인 시스템을 갖추고 있다(토큰 + `components/ui/` 11종 + theme-provider/toaster/switcher). 이번 작업은 그 중 **검증된 핵심만 의도적으로 선별 이식**하는 것이다.

## 3. 스코프

### 포함
- Tailwind v4 빌드 토대 도입(`postcss.config.mjs`, `globals.css` 전환)
- 디자인 토큰: 코어 시맨틱 색 19개 + radius 4단계 + `page` + light/dark 2테마
- 프리미티브 7종: `button` `input` `textarea` `label` `card` `badge` `separator`
- 앱 셸 컴포넌트화 + 테마 토글(next-themes) + 토스트(sonner)
- 기존 화면 마이그레이션: `login` · 앱 셸 · `admin/settings`(+ `settings-editor`) · `admin`

### 제외(향후 도메인 Phase에서 그 화면과 함께 추가)
- 프리미티브: `select` `dialog` `dropdown-menu` `form`(react-hook-form 래퍼)
- 토큰: pastel 테마, 워크플로 status 6색, 공휴일 색, FullCalendar 오버라이드, step-active/header 등 보조 시맨틱
- 의존성: `@base-ui/react`(위 헤드리스 위젯 도입 시점에 추가)
- UI 자동 테스트 인프라(Phase 1·2와 동일하게 이번에도 미도입 — 수동 스모크로 검증)

## 4. 아키텍처: 디렉터리와 경계

### 디렉터리(신규 ⊕ / 변경 △)

```
src/lib/utils.ts                    ⊕ cn = clsx + tailwind-merge (기존 lib element에 포함)
src/components/ui/                  ⊕ 프리미티브 (신규 ui element)
  button.tsx input.tsx textarea.tsx label.tsx card.tsx badge.tsx separator.tsx
src/components/theme-provider.tsx   ⊕ next-themes 래퍼 (light/dark 2테마)
src/components/themed-toaster.tsx   ⊕ sonner Toaster (테마 연동)
src/components/theme-switcher.tsx   ⊕ light/dark 토글
src/app/globals.css                 △ Tailwind v4 @theme 토큰으로 전환
src/app/layout.tsx                  △ ThemeProvider + ThemedToaster 래핑
postcss.config.mjs                  ⊕ @tailwindcss/postcss
```

`src/components`를 `src/lib/ui`로 흡수하지 않고 별도 `ui` element로 둔다. 프리미티브·provider·toaster·switcher가 늘어날 때 더 자연스럽고, provider류와 primitive류를 한 "공유 프레젠테이션 레이어"로 묶는 것이 현재 단계에 적절하다(둘을 별도 element로 쪼개면 규칙만 늘고 얻는 안전성은 작다).

### 경계 규칙(eslint.config.mjs)

`boundaries/elements`에 `ui` element를 추가한다.

```js
{ type: "ui", pattern: "src/components", mode: "folder" }
```

`boundaries/element-types` rules를 다음과 같이 변경한다.

```js
{ from: ["ui"],  allow: ["ui", "lib"] }                                // 신규
{ from: ["app"], allow: ["app", "kernel", "lib", "module", "ui"] }     // 기존 app 규칙에 "ui" 추가
```

- **`ui → ui` 허용**이 핵심이다. `theme-switcher`가 `Button`을 쓰거나 프리미티브끼리 조합되는 경우를 위해서다.
- `ui`는 `lib`(=`cn`)만 추가로 참조하고 `kernel`/`module`/`app`은 참조하지 않는다(의존 역류 차단).
- **`module → ui`는 이번에 추가하지 않는다(보류).** 현재 `src/modules`에는 React 컴포넌트(`.tsx`)가 없고 순수 서비스/로직 레이어다(`integrations/index.ts`, `integrations/status.ts`). 지금 열면 죽은 권한이 되며 fail-closed 원칙에 어긋난다.
- 위 보류의 귀결: **도메인 화면에 딸린 client 컴포넌트는 당분간 `src/app/...`에 colocate**한다(현재 `settings-editor.tsx`가 그 선례 — app element). Phase 3+에서 `src/modules/*/components`를 공식화할 때 `module → ui` 추가를 재검토한다.
- `cn`은 `src/lib/utils.ts`이므로 기존 `lib` element에 자연히 포함되어 별도 규칙이 필요 없다. 프리미티브가 `@/lib/utils`만 참조하는 단방향이 유지된다.

## 5. 토큰(src/app/globals.css — Tailwind v4 @theme)

Tailwind v4는 CSS-first 설정이다. `tailwind.config.js`는 두지 않고 토큰·variant를 전부 `globals.css`에 둔다. Tailwind는 `--color-*`/`--radius-*` 네임스페이스의 토큰만 `bg-*`/`text-*`/`rounded-*` 유틸로 노출하므로, 유틸로 쓸 토큰은 반드시 이 네임스페이스를 따른다.

### 가져올 것
- **코어 시맨틱 색 19개**: `background` `foreground` `card`(+`-foreground`) `popover`(+`-foreground`) `primary`(+`-foreground`) `secondary`(+`-foreground`) `muted`(+`-foreground`) `accent`(+`-foreground`) `destructive`(+`-foreground`) `border` `input` `ring`. oklch 기반(light) + `[data-theme="dark"]` 블록.
  - 짝(`-foreground`) 토큰은 버튼 variant가 당장 소비하지 않더라도 **세트 일관성을 위해 유지**한다.
- **radius 4단계**: `--radius-sm` `--radius-md` `--radius-lg` `--radius-xl`
- **앱 배경 위계 1개**: `--color-page`(셸 배경). day-sync의 `surface`/`subtle`/`header` 등 보조 시맨틱은 두지 않고 코어의 `card`/`muted-foreground`/`border`로 대체한다. 이후 도메인 화면이 실제로 요구하는 의미가 생기면 그때 추가한다.
- `@custom-variant dark`

### 구조

```css
@import "tailwindcss";
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

@theme {
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.145 0 0);
  /* …코어 19색… */
  --color-page: oklch(0.985 0 0);
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
}

@layer base {
  [data-theme="dark"] {
    --color-background: #0a0a0a;
    /* …dark 값… */
  }
}
```

(정확한 색 값은 day-sync `globals.css`에서 코어 토큰만 가져와 검증한다.)

## 6. 프리미티브 7종(src/components/ui/)

`button` `input` `textarea` `label` `card` `badge` `separator`.

- 전부 **native element + `cva` + `cn(@/lib/utils)`** 패턴으로 구현한다. 이번 7종에는 `@base-ui/react` import가 없다.
- `button`은 day-sync가 Base UI `Button`을 썼으나 native `<button>` + cva로 대체한다. day-sync의 cva 클래스를 가져오되 Base UI 전용 셀렉터(`aria-expanded:*` 등 트리거 상태용)는 native에서 무의미하므로 정리한다.
- `card`는 복합 컴포넌트(`Card`/`Header`/`Title`/`Description`/`Action`/`Content`/`Footer`).
- 이식은 통째 복사가 아니라, day-sync 코드를 가져와 import 경로(`@/lib/utils`)와 deps 버전을 검증한 뒤 적응시킨다(ADR-0001).
- **Base UI 필요 여부는 구현 직전 프리미티브별로 판정**한다(Base UI는 버전별 API 변동이 있음). 7종은 native로 충분하다고 보지만, 구현 중 접근성·동작상 Base UI가 분명히 유리한 프리미티브가 있으면 그 시점에 `@base-ui/react`를 도입한다.

## 7. 앱 셸 · 테마 · 토스트

### 테마(next-themes)
- `ThemeProvider`: `attribute="data-theme"`, `themes={["light","dark"]}`(pastel 제외), `defaultTheme="light"`, `enableSystem={false}`
- root `<html>`에 `suppressHydrationWarning`(next-themes hydration 경고 방지)

### 토스트(sonner)
- `ThemedToaster`: `richColors`, `position="top-right"`, 현재 테마와 연동(`theme === "dark" ? "dark" : "light"`)

### 토글
- `theme-switcher`: `Button`(ghost/icon) + lucide `Sun`/`Moon`, light↔dark 토글. day-sync는 3테마 순환이지만 2테마로 단순화한다.

## 8. 기존 화면 마이그레이션

| 파일 | 변경 |
| --- | --- |
| `src/app/layout.tsx` | `ThemeProvider`+`ThemedToaster`로 래핑, `body`에 `bg-page text-foreground antialiased min-h-screen`, `<html>`에 `suppressHydrationWarning` |
| `src/app/(app)/layout.tsx` | 인라인 셸 → Tailwind: `bg-card` 사이드바, 네비 링크, theme-switcher 추가, 로그아웃 `Button` |
| `src/app/login/page.tsx` | 인라인 폼 → `Card`+`Input`+`Label`+`Button`. server action 로그인 로직은 유지 |
| `src/app/(app)/admin/settings/page.tsx` | 인라인 + `var(--*)` → `Card` 섹션 + 연동 상태 `Badge` |
| `src/app/(app)/admin/settings/settings-editor.tsx` | 인라인 + `setMessage` → `Textarea`+`Button`. 저장 피드백을 sonner toast로 이전(저장됨/409/422/실패). 저장 버튼의 `disabled`+"저장 중…" 상태는 유지하고, 실패 사유를 토스트 본문에 명확히 담는다(sonner의 aria-live region이 스크린리더 안내를 제공) |
| `src/app/(app)/admin/page.tsx`, `admin-links.tsx` | 가벼운 정리(`Button`/리스트) |
| dashboard·calendar·leave·workflows `page.tsx` | "준비 중" 본문 미변경 — 새 셸이 자동 적용 |
| `src/app/page.tsx` | 미변경(redirect만) |

`globals.css` 전환으로 기존 `var(--bg/--fg/--muted/--border)` 참조는 위 마이그레이션에서 함께 제거된다.

## 9. 의존성과 빌드

```
npm i tailwind-merge next-themes sonner
npm i -D tailwindcss @tailwindcss/postcss
```

- `tailwindcss`·`@tailwindcss/postcss`는 빌드타임이므로 devDependencies. `tailwind-merge`·`next-themes`·`sonner`는 런타임 dependencies. `cva`·`clsx`·`lucide-react`는 이미 존재.
- `@base-ui/react`는 이번에 추가하지 않는다(7종에 import 없음).
- `postcss.config.mjs` 신규(`@tailwindcss/postcss`). `next.config.ts`는 변경 없음 — Tailwind는 postcss 단계에서 처리되며, day-sync가 Next 16 Turbopack + Tailwind v4로 이미 동작하므로 호환이 확인된다.

## 10. 검증

- `npm run lint`(boundaries 규칙 포함) · `npm run typecheck` · `npm run build` 통과
- 기존 92개 테스트 회귀 없음(UI 변경이 로직 테스트를 깨지 않을 것)
- 수동 스모크: login → settings 렌더 / 다크 토글 동작 / settings 저장 토스트 / 동시편집 409 토스트 / 비권한 계정 redirect
- UI 자동 테스트 인프라는 이번에도 미도입(Phase 1·2 정책과 동일)

## 11. 향후로 미룬 것

- 프리미티브 `select`/`dialog`/`dropdown-menu`/`form` + `@base-ui/react` 도입(workflows 모달·leave 화면 등에서)
- 워크플로 status 색·공휴일 색·FullCalendar 토큰(workflows/calendar Phase에서 화면 요구와 함께)
- pastel 등 추가 테마, 보조 시맨틱(`surface`/`subtle`/`header`)
- `module → ui` 경계 허용 + `src/modules/*/components` 공식화
- UI 자동 테스트 인프라
