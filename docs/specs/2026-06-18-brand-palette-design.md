# 브랜드 팔레트 패스(Brand Palette Pass) 설계

작성일: 2026-06-18
상태: 설계 확정(구현 계획 대기)
선행: `docs/specs/2026-06-18-design-system-foundation-design.md`(토큰·프리미티브 기반)

## 1. 배경과 목적

디자인 시스템 기반 작업으로 코어 시맨틱 토큰 19개 + 프리미티브 7종 + 앱 셸·테마·토스트가 깔렸고, 모든 화면이 인라인 스타일이 아니라 **시맨틱 토큰을 거쳐** 그려진다. 단, 그 토큰은 의도적으로 중립 그레이스케일(레드 `destructive`만 유채색)이다.

이 패스의 목적은 그 중립 토큰을 **비비드 파스텔 브랜드 팔레트로 재테마**하는 것이다. 프리미티브가 이미 시맨틱 토큰만 소비하므로, 토큰 값을 바꾸면 로그인·셸·settings 등 전 화면에 자동 전파된다. 브랜드 방향은 메모리 `ops-hub-vibrant-palette-direction`(Novera 핀테크 무드보드 참조)에서 확정됐다.

참조 무드보드의 실제 구조는 "파스텔을 전면에 까는 것"이 아니라 **깨끗한 표면 + 블랙 주요 CTA + 파스텔 액센트**다. 본 설계는 그 구조를 따르되, 내부 업무 허브 특성에 맞춰 표면에 아주 옅은 라벤더 틴트를 더한 **틴티드 하이브리드**를 채택한다.

## 2. 핵심 결정 요약

| 결정 | 선택 | 근거 |
| --- | --- | --- |
| 보드니스 | **틴티드 하이브리드** | 표면에 옅은 라벤더 틴트 + 블랙 CTA + 파스텔 액센트. 무드보드 구조에 충실하되 데일리 업무 도구로서 차분함 유지. |
| 주요 CTA | **블랙 유지** | 무드보드 자체가 CTA를 블랙으로 둠. `--color-primary`/`destructive`는 변경하지 않음. |
| Playfair Display | **워드마크 + 숫자/라틴 display만** | Playfair에 한글 글리프가 없음. blanket 헤딩 적용 시 한글은 sans 폴백되어 같은 제목 안에서 두 서체가 섞임. 의도적으로 워드마크·지표 숫자에만 적용. |
| 적용 범위 | **더 넓은 브랜드 패스** | 토큰 재테마 + 폰트 + 활성 nav pill + login 리터치 + 대시보드 샘플 지표 카드(시안/라임 시연). |
| 다크모드 | **중립 다크 표면 + 밝은 파스텔 액센트** | 파스텔은 밝아서 다크 위에서 액센트로 선명. 대비·접근성 가장 안전. |

## 3. 스코프

### 포함
- `globals.css @theme` 라이트/다크 토큰 retint(아래 §5 값)
- 신규 브랜드 토큰 4종(+ 일부 `-foreground`) 추가
- `--font-display`(Playfair Display) 도입 — `next/font/google`, 새 npm 의존성 없음
- 활성 nav pill을 위한 nav client 컴포넌트 분리(유일한 구조 추가)
- 기존 화면 브랜드 적용: login 카드 리터치, 대시보드 placeholder에 샘플 지표 카드 데모

### 제외(향후 도메인 Phase에서)
- Badge 브랜드 색 variant 정식화(이번엔 대시보드 데모에 인라인 브랜드 클래스만)
- 차트 라이브러리/FullCalendar 토큰, 워크플로 status 색, 공휴일 색
- 실제 도메인 화면의 지표 숫자에 Playfair 적용(그 화면과 함께)
- light/dark 외 추가 테마(pastel 등)
- UI 자동 테스트 인프라(기존 정책과 동일하게 미도입)

## 4. 토큰 전략

두 갈래로 나눈다.

**(a) 기존 시맨틱 토큰 retint** — 프리미티브가 변경 없이 자동 수신
- `page` → 옅은 라벤더 틴트(셸 배경)
- `ring` → 접근성 충족 딥 바이올렛(`#7C3AED`, 브랜드 계열이되 장식용 `brand` 라벤더와 **분리** — §8). 모든 포커스 ring을 구동
- `accent`/`accent-foreground` → 라벤더 틴트 / 딥퍼플(hover·활성 nav pill 표면)
- `secondary`·`muted` → 옅은 라벤더-그레이(보조 버튼·nav hover)
- `muted-foreground` → 살짝 퍼플 그레이
- `border`·`input` → 라벤더-그레이
- `background`·`card`·`popover`·`primary`(블랙 CTA)·`destructive`(레드) → **유지**

**(b) 신규 브랜드 토큰 추가** — 향후 도메인 화면이 소비, 이번엔 데모에서만 일부 사용
- `--color-brand`(라벤더) + `--color-brand-foreground`(다크)
- `--color-brand-2`(핑크) + `--color-brand-2-foreground`(다크)
- `--color-chart-cyan`(시안) — 차트·데이터 액센트
- `--color-point-lime`(라임) — 소량 강조 포인트

소프트 배경은 별도 토큰 없이 opacity 유틸로 만든다(`bg-brand/15` 등). 기존 `button` destructive variant(`bg-destructive/10`)와 동일 패턴이라 토큰 수를 늘리지 않는다.

## 5. 정확한 토큰 값 (src/app/globals.css)

브랜드 파스텔은 canonical hex가 진실원이다. 라이트 중립/틴트도 본 spec은 hex 기준값을 제시한다(구현 시 house style상 oklch로 변환 가능하나 시각 결과는 아래 hex와 동일해야 한다). 변경 없는 토큰은 현재 oklch 값을 그대로 둔다.

### @theme (라이트) — 변경되는 토큰
| 토큰 | 현재 | 신규 |
| --- | --- | --- |
| `--color-page` | oklch(0.985 0 0) | `#F6F3FC` |
| `--color-ring` | oklch(0.708 0 0) | `#7C3AED` |
| `--color-accent` | oklch(0.97 0 0) | `#ECE3FF` |
| `--color-accent-foreground` | oklch(0.205 0 0) | `#5B3D9E` |
| `--color-secondary` | oklch(0.97 0 0) | `#F1EEF8` |
| `--color-muted` | oklch(0.97 0 0) | `#F1EEF8` |
| `--color-muted-foreground` | oklch(0.556 0 0) | `#6B6878` |
| `--color-border` | oklch(0.922 0 0) | `#E9E5F2` |
| `--color-input` | oklch(0.922 0 0) | `#E9E5F2` |

유지(변경 없음): `background` `foreground` `card(+fg)` `popover(+fg)` `primary(+fg)` `secondary-foreground` `destructive(+fg)`.

> `ring`(`#7C3AED`)은 의도적으로 `brand` 라벤더(`#BA8DFF`)와 다른 값이다. 라벤더는 흰 배경 대비 ≈2.5:1로 포커스 표시에 쓰기엔 WCAG 미달이므로, 포커스 ring만 대비를 만족하는 딥 바이올렛으로 분리한다(§8). 라벤더는 장식(pill·액센트·badge)에만.

### 신규 브랜드 토큰 (@theme, 라이트·다크 공통 hue)
| 토큰 | 값 |
| --- | --- |
| `--color-brand` | `#BA8DFF` |
| `--color-brand-foreground` | `#2A1A4A` |
| `--color-brand-2` | `#FBC6F2` |
| `--color-brand-2-foreground` | `#7A2E66` |
| `--color-chart-cyan` | `#24D0FE` |
| `--color-point-lime` | `#EAFF00` |

`chart-cyan`·`point-lime`은 매우 밝아 텍스트색으로 쓰지 않는다. 칩/소프트 배경(`bg-chart-cyan/15`)으로 쓰고 텍스트는 다크(`text-foreground` 또는 딥 변형)로 둔다.

### [data-theme="dark"] — 변경되는 토큰
| 토큰 | 현재 | 신규 |
| --- | --- | --- |
| `--color-background` | #0a0a0a | `#0C0B11` |
| `--color-foreground` | #fafafa | `#F4F2F8` |
| `--color-card` | #171717 | `#16141C` |
| `--color-card-foreground` | #fafafa | `#F4F2F8` |
| `--color-popover` | #171717 | `#16141C` |
| `--color-popover-foreground` | #fafafa | `#F4F2F8` |
| `--color-primary` | #fafafa | `#F4F2F8` |
| `--color-primary-foreground` | #0a0a0a | `#16141C` |
| `--color-secondary` | #262626 | `#221F2B` |
| `--color-secondary-foreground` | #fafafa | `#F4F2F8` |
| `--color-muted` | #262626 | `#221F2B` |
| `--color-muted-foreground` | #a3a3a3 | `#9A95A8` |
| `--color-accent` | #262626 | `#241E33` |
| `--color-accent-foreground` | #fafafa | `#D9C9FF` |
| `--color-border` | #262626 | `#2A2733` |
| `--color-input` | #262626 | `#2A2733` |
| `--color-ring` | #d4d4d4 | `#C9A8FF` |
| `--color-page` | #0a0a0a | `#0C0B11` |
| `--color-destructive-foreground` | #fafafa | `#F4F2F8` |

유지: `destructive`(#ef4444). (`destructive-foreground`는 다크 전반의 off-white를 `#F4F2F8`로 통일하는 차원에서 위 표에 포함 — 레드 위 텍스트 의미는 동일.)

브랜드 4색은 다크에서도 동일 hex(밝게 액센트). `brand-foreground`(#2A1A4A)는 라벤더가 라이트 컬러라 다크모드에서도 다크 텍스트가 맞다.

## 6. 폰트 (Playfair Display)

- `src/app/layout.tsx`에서 `next/font/google`의 `Playfair_Display`를 로드: `weight: ["500","600"]`, `style: ["normal","italic"]`, `subsets: ["latin"]`, `variable: "--font-playfair"`, `display: "swap"`. (Google Fonts를 빌드타임에 self-host → 런타임 외부 의존 없음, 새 npm 패키지 없음)
- `<html>`에 `playfair.variable` className 추가(기존 `suppressHydrationWarning` 유지). body의 `font-sans`는 유지.
- `globals.css @theme`에 `--font-display: var(--font-playfair), Georgia, "Times New Roman", serif;` 추가 → `font-display` 유틸 노출.
- 적용처(의도적):
  - 사이드바 워드마크 `ops-hub`, login 워드마크 → `font-display`
  - 대시보드 샘플 지표 카드의 숫자 → `font-display`
  - **한글 헤딩·본문에는 적용하지 않는다.**

## 7. 파일 변경

| 파일 | 변경 |
| --- | --- |
| `src/app/globals.css` | @theme retint(§5) + 브랜드 토큰 + `--font-display`, dark 블록 retint(§5) |
| `src/app/layout.tsx` | Playfair `next/font` 로드, `<html>`에 variable class |
| `src/app/(app)/layout.tsx` | nav를 `<AppNav>`로 교체, 워드마크 `font-display` |
| `src/app/(app)/app-nav.tsx` | **신규(client)**. props로 nav 항목 받아 `usePathname()`으로 활성 판정, 활성 링크 = 라벤더 pill |
| `src/app/login/page.tsx` | Playfair 워드마크 추가 + 틴트 표면 위 카드(가벼운 브랜드 액센트). 로그인 로직 무변경 |
| `src/app/(app)/dashboard/page.tsx` | "준비 중" 자리에 **샘플 지표 카드 데모**(Playfair 숫자 + 시안/라임 트렌드 칩). 명시적으로 "디자인 미리보기" 데모 — 향후 실제 대시보드로 교체 |

### nav client 분리 상세
활성 pill은 현재 경로를 알아야 하는데 `usePathname`은 client 전용이다. 따라서 nav 렌더를 `app-nav.tsx`("use client")로 분리한다.
- `(app)/layout.tsx`(server)는 `loadNavigation` 결과를 `<AppNav items={nav} />`로 전달.
- `AppNav`는 항목을 순회하며 `pathname === item.href`(또는 하위 경로 `startsWith`)면 활성 pill(`rounded-full bg-accent text-accent-foreground`), 아니면 기존 스타일(`text-muted-foreground hover:bg-muted hover:text-foreground`).
- 경계: `app-nav.tsx`는 app element이며 `next/navigation`·`next/link`만 참조 → `boundaries` 규칙 추가 불필요(기존 `app` 규칙 내). 디자인 시스템 spec의 "client 컴포넌트는 src/app에 colocate"(예: `settings-editor.tsx`) 선례를 따른다.

## 8. 접근성(WCAG)

- **파스텔을 텍스트색으로 쓰지 않는다.** 파스텔은 fill/액센트로만 쓰고, 그 위 텍스트는 항상 다크(예: 라벤더 pill 위 `accent-foreground` 딥퍼플, 대시보드 칩은 소프트 파스텔 배경 + 다크 텍스트). 블랙-온-파스텔/다크-온-파스텔은 충분한 대비 확보.
- **포커스 ring(설계로 보장, 완화책에 의존하지 않음)**: 장식용 라벤더(`#BA8DFF`)는 흰 배경 대비 비텍스트 대비가 **약 2.5:1로 WCAG 1.4.11(3:1) 미달**이다. 따라서 `--color-ring`(라이트)은 라벤더를 그대로 쓰지 않고 **딥 바이올렛 `#7C3AED`** 로 분리한다 — 흰 배경 대비 **≈5.7:1**, `background`·`page`·`card`·`input` 표면 모두 3:1을 초과한다. `brand` 라벤더는 pill·액센트·badge 등 장식에만 쓴다. 이로써 가시성이 `focus-visible:border-ring` border 변화나 수동 스모크에 **의존하지 않고 토큰 값 자체로 보장**된다(border+ring 조합은 추가 보강일 뿐).
- 다크모드 `ring`(`#C9A8FF`)은 어두운 배경(`#0C0B11`/`#16141C`) 대비가 3:1을 크게 상회한다.

## 9. 검증

- 자동 게이트: `npm run typecheck` · `npm run lint`(boundaries 포함) · `npm run build` 통과
- **대비 게이트(필수 — 수동 스모크로 대체·면제 불가)**: 라이트 `--color-ring`이 `background`·`page`·`card`·`input` 표면 각각에 대해 ≥3:1(WCAG 1.4.11)임을 구현 시 수치로 확인한다(현 값 `#7C3AED` 충족). 미달이면 머지 차단. 향후 `ring` 값을 바꿀 때도 동일 게이트 적용.
- 기존 테스트 회귀 없음(순수 프레젠테이션 변경 — 로직/권한 테스트에 영향 없을 것)
- 수동 스모크(라이트·다크 각각): page 틴트 표면, 활성 nav pill, 라벤더 포커스 ring, 워드마크 Playfair 렌더, login 화면, 대시보드 샘플 카드(Playfair 숫자 + 시안/라임 칩), 테마 토글 시 토큰 전환, 하이드레이션 경고 없음
- Playwright 스크린샷으로 라이트/다크 캡처(기존 디자인 시스템 검증과 동일 방식)
- UI 자동 테스트 인프라는 이번에도 미도입

## 10. 향후로 미룬 것

- Badge 브랜드 색 variant 정식화(연동 상태·워크플로 status 등 실제 의미가 생길 때)
- 차트 라이브러리 + `chart-cyan`/`point-lime` 본격 사용, FullCalendar 토큰
- 실제 도메인 지표 숫자에 Playfair 적용
- light/dark 외 추가 테마
