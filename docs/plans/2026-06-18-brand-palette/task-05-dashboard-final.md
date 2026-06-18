# task-05 — dashboard 샘플 지표 카드 + 최종 검증

**목적:** 대시보드 "준비 중" placeholder를 **샘플 지표 카드 데모**(Playfair 숫자 + 시안/라임 트렌드 칩)로 교체해 브랜드 팔레트를 시연한다. 명시적 "디자인 미리보기" 더미 — 향후 실제 대시보드로 교체. 마지막으로 패스 전체의 최종 검증(게이트 + 스크린샷)을 수행한다.

## Files

- **Modify:** `src/app/(app)/dashboard/page.tsx` — placeholder → 샘플 지표 카드 그리드

## Prep

- spec §7(파일 변경: dashboard), §8(파스텔 위 다크 텍스트)
- 엔트리포인트 §Shared Contracts "소프트 배경 패턴", "폰트"
- 현재 `src/app/(app)/dashboard/page.tsx`(서버 컴포넌트, `<h1>대시보드</h1><p>준비 중입니다.</p>`)

## Deps

01(`chart-cyan`/`point-lime` 토큰), 02(`font-display` 숫자).

## Steps (프레젠테이션 — 자동 테스트 없음, 게이트 + 스모크로 검증)

### 1. dashboard/page.tsx 교체

`src/app/(app)/dashboard/page.tsx`를 다음으로 만든다(서버 컴포넌트 유지 — hook·"use client" 없음). 카드는 디자인 시스템 `Card` 프리미티브를 쓰고, 숫자엔 `font-display`, 트렌드 칩은 파스텔 소프트 배경 + 다크 텍스트.

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// 디자인 미리보기 데모 — 실제 지표가 아니라 브랜드 팔레트/Playfair 시연용 더미.
// 향후 실제 대시보드 위젯으로 교체한다.
const sampleMetrics = [
  { label: "이번 주 워크플로", value: "24", trend: "+12%", tone: "cyan" as const },
  { label: "대기 중 결재", value: "7", trend: "-3", tone: "lime" as const },
  { label: "잔여 연차(팀 평균)", value: "8.5", trend: "+0.5", tone: "cyan" as const },
];

// 파스텔은 소프트 배경(fill)으로만, 텍스트는 다크(text-foreground) — spec §8.
const trendChip: Record<"cyan" | "lime", string> = {
  cyan: "bg-chart-cyan/15 text-foreground",
  lime: "bg-point-lime/25 text-foreground",
};

export default function DashboardPage() {
  return (
    <section className="grid gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">대시보드</h1>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          디자인 미리보기
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sampleMetrics.map((m) => (
          <Card key={m.label}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {m.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-end justify-between">
              <span className="font-display text-4xl font-semibold tracking-tight">
                {m.value}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${trendChip[m.tone]}`}
              >
                {m.trend}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
```

### 2. 게이트 + 스모크

```bash
npm run typecheck
npm run lint
npm run build
```

수동 스모크(로그인 후 `/dashboard`): "디자인 미리보기" 배지, 카드 3개, 숫자가 Playfair, 시안(`bg-chart-cyan/15`)·라임(`bg-point-lime/25`) 칩 위 텍스트가 다크로 충분히 읽힘.

### 3. 커밋

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "Add sample metric cards demo to dashboard (Playfair numbers, brand chips)"
```

### 4. 패스 전체 최종 검증 (spec §9)

전 태스크 머지 후 한 번에 확인한다.

```bash
npm run typecheck   # 에러 없음
npm run lint        # 에러 없음(boundaries 포함)
npm run build       # 성공(Playfair self-host 포함)
npm test            # 96개(기존 92 + 대비 게이트 4) 전부 통과 — 대비 게이트 면제 불가
```

**대비 게이트(필수)**: `npm test`의 `globals-contrast`가 라이트 `--color-ring`(`#7C3AED`)이 background·page·card·input 각 표면에 ≥3:1임을 단언하며 통과해야 한다. 미달이면 머지 차단.

**Playwright 스크린샷(라이트/다크 각각)** — 기존 디자인 시스템 검증과 동일 방식으로 캡처해 시각 회귀 확인:
- login 화면(워드마크 Playfair + 브랜드 액센트)
- 셸 + 활성 nav pill(라벤더), page 틴트 표면
- dashboard 샘플 카드(Playfair 숫자 + 시안/라임 칩)
- 포커스 ring(딥 바이올렛) — 입력 필드 포커스 상태
- 테마 토글 시 토큰 전환, 하이드레이션 경고(콘솔) 없음

### 5. 엔트리포인트 outcome 갱신

`docs/plans/2026-06-18-brand-palette.md`의 Task table에서 각 행 status `[ ]`→`[x]`로 바꾸고, 05행 outcome에 "브랜드 패스 완료 — 토큰 retint·Playfair·활성 pill·login/대시보드 데모, 대비 게이트 상주, 96 tests green" 기록.

## Acceptance Criteria

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

- 위 4개 전부 통과(대비 게이트 포함).
- `dashboard/page.tsx`가 서버 컴포넌트로 샘플 카드 3개를 렌더, 숫자 `font-display`, 칩 파스텔 배경 + 다크 텍스트.
- 라이트/다크 Playwright 스크린샷 확보, 하이드레이션 경고 없음.

## Cautions

- **dashboard를 client 컴포넌트로 만들지 말 것.** 이유: 정적 더미라 hook·상호작용이 없다. 서버 컴포넌트 유지가 맞다.
- **파스텔 칩 텍스트를 파스텔색으로 두지 말 것.** 이유: `chart-cyan`/`point-lime`은 매우 밝아 텍스트 대비 미달. 배경(fill)으로만 쓰고 텍스트는 `text-foreground`(spec §8).
- **"디자인 미리보기" 표식을 빼지 말 것.** 이유: 실제 지표로 오인 방지. 이 카드는 명시적 데모이며 향후 실 위젯으로 교체된다(spec §3 제외 항목).
- **샘플 더미를 실제 데이터 조회로 바꾸지 말 것.** 이유: 데이터 연동은 도메인 Phase 범위. 이 패스는 프레젠테이션 시연만.
