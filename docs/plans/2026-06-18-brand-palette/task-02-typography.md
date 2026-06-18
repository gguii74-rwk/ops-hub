# task-02 — 타이포: `--font-display` + Playfair next/font

**목적:** Playfair Display를 `next/font/google`로 self-host 로드하고 `--font-display` 토큰을 노출해 `font-display` 유틸이 동작하게 한다. 새 npm 의존성 없음. 적용처(워드마크·숫자)는 task-03/04/05에서 소비.

## Files

- **Modify:** `src/app/layout.tsx` — Playfair `next/font` 로드, `<html>`에 variable class
- **Modify:** `src/app/globals.css` — `@theme`에 `--font-display` 한 줄 추가

## Prep

- spec §6(폰트)
- 엔트리포인트 §Shared Contracts "폰트"
- 현재 `src/app/layout.tsx`(메타데이터 + ThemeProvider/ThemedToaster), `src/app/globals.css`(task-01 이후: 색 토큰 retint 완료, `--font-sans` 존재, `--font-display` 아직 없음)

## Deps

01 (globals.css 색 토큰이 먼저 들어가 있어야 같은 파일 편집이 깔끔; `--font-sans` 앵커는 task-01이 건드리지 않으므로 충돌 없음)

## Steps (프레젠테이션 — 자동 테스트 없음, 게이트로 검증)

### 1. layout.tsx에 Playfair 로드

`src/app/layout.tsx`를 다음으로 만든다(서버 컴포넌트 유지, 기존 구조 보존, 폰트만 추가):

```tsx
import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemedToaster } from "@/components/themed-toaster";

const playfair = Playfair_Display({
  weight: ["500", "600"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ops-hub",
  description: "내부 업무 운영 허브",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={playfair.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-page text-foreground antialiased font-sans">
        <ThemeProvider>
          {children}
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

### 2. globals.css에 `--font-display` 추가

`@theme` 블록의 `--font-sans` 선언 **바로 뒤**(닫는 `}` 직전)에 한 줄 추가한다. `--font-sans` 블록은 task-01이 건드리지 않으므로 안전한 앵커다.

`--font-sans` 선언이 다음으로 끝난다:

```css
    "Malgun Gothic", sans-serif;
}
```

이를 다음으로 바꾼다:

```css
    "Malgun Gothic", sans-serif;

  --font-display: var(--font-playfair), Georgia, "Times New Roman", serif;
}
```

### 3. 빌드로 폰트 self-host 확인

```bash
npm run typecheck
npm run lint
npm run build
```

기대: 통과. `next build`가 빌드타임에 Playfair를 받아 self-host 번들에 포함한다.

### 4. 커밋

```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "Load Playfair Display via next/font and expose --font-display token"
```

## Acceptance Criteria

```bash
npm run typecheck   # 에러 없음
npm run lint        # 에러 없음
npm run build       # 성공(빌드 중 Playfair fetch & self-host)
npm test            # 기존 + 대비 게이트 전부 통과(회귀 없음)
```

- `layout.tsx`의 `<html>`에 `className={playfair.variable}` 존재, `suppressHydrationWarning` 유지, body `font-sans` 유지.
- `globals.css @theme`에 `--font-display: var(--font-playfair), ...` 존재.
- 수동 확인(선택, 이 시점엔 소비처 없음): 임시로 어느 요소에 `font-display` 클래스를 주면 라틴 글자가 세리프(Playfair)로 렌더(실제 적용은 task-03~05).

## Cautions

- **body의 `font-sans`를 제거하거나 `font-display`로 바꾸지 말 것.** 이유: 본문·한글 기본 서체는 sans여야 한다. Playfair엔 한글 글리프가 없어 blanket 적용 시 한글이 폴백돼 한 제목 안에서 두 서체가 섞인다(spec §2·§6).
- **`next build`는 빌드타임에 Google Fonts를 받는다(네트워크 필요).** 이유: self-host 방식이라 빌드 시 1회 fetch 후 번들에 포함된다 — 런타임 외부 의존은 없다. 오프라인 빌드 환경이면 이 단계에서 막힐 수 있으니 네트워크 확인.
- **`--font-display` 값에서 `var(--font-playfair)` fallback 체인을 지우지 말 것.** 이유: 폰트 로드 전/실패 시 Georgia serif로 우아하게 폴백돼야 한다.
