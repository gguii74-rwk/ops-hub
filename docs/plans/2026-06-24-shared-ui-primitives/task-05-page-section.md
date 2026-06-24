# Task 05 — PageHeader / PageSection 신설

페이지 타이틀(중복 + 드리프트)과 max-w(제각각)를 통일하는 래퍼 신설.

## Files
- **Create:** `src/components/ui/page-section.tsx`

## Prep
- 읽기: 엔트리포인트 §SC-1 의 `page-section.tsx` 전체 코드(그대로 사용), §SC-0 D5.
- 배경: 지배형 타이틀 = `<h1 className="font-display text-2xl font-semibold tracking-tight">`(users·calendar·leave/manage·workflows 등). 드리프트 = admin·settings·dashboard의 `text-xl font-semibold`(font-display 없음). max-w: 폼 페이지 `max-w-lg`(users/new)·`max-w-2xl`(users/[id]), 목록은 캡 없음.

## Deps
없음.

## Steps

1. **`src/components/ui/page-section.tsx` 생성** — 엔트리포인트 §SC-1 `page-section.tsx` 코드를 그대로 작성한다. 설계 포인트:
   - `PageHeader({ title, subtitle?, actions? })` — `<h1 className="font-display text-2xl font-semibold tracking-tight">` + 선택 subtitle(`text-sm text-muted-foreground`) + 선택 actions(우측 정렬, `shrink-0`).
   - `PageSection({ title, subtitle?, actions?, width?, className?, children })` — `<section className="space-y-4 {WIDTH[width]}">` 안에서 `PageHeader` 렌더 + children. `width`: `"full"`(기본, 캡 없음) / `"form"`(`mx-auto w-full max-w-lg`) / `"wide"`(`mx-auto w-full max-w-2xl`).
   - 2개 named export: `PageHeader`, `PageSection`.

2. **검증** (§SC-4): `npm run typecheck && npm run lint && npm run build`.

3. **commit** — `git add src/components/ui/page-section.tsx`.

## Acceptance Criteria
- typecheck/lint/build 통과.
- `PageHeader`·`PageSection` named export.
- `width` 3종이 §SC-1 `WIDTH` 맵과 일치(`full=""`, `form="mx-auto w-full max-w-lg"`, `wide="mx-auto w-full max-w-2xl"`).
- `subtitle`/`actions` 미전달 시 렌더되지 않음(불필요 빈 div 없음).

## Cautions
- **타이포 스케일/간격을 새로 정의하지 말 것. 이유:** 기존 지배형 클래스를 그대로 정규로 채택(D5). 새 토큰·새 크기 도입은 범위 밖.
- 소비처 미수정(신규 파일만). page.tsx 이관은 task-09.
