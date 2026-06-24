# Task 02 — Table 프리미티브 신설

bare `<table>` 복붙을 대체할 최소 compound Table 신설.

## Files
- **Create:** `src/components/ui/table.tsx`

## Prep
- 읽기: 엔트리포인트 §SC-1 의 `table.tsx` 전체 코드(그대로 사용).
- 배경: 정규 패턴은 `overflow-x-auto rounded-lg border` → `table w-full text-sm` → `thead bg-muted/50 text-left text-muted-foreground` → 본문 `tr border-t border-border` → `td/th p-2` → 빈행 `td colSpan p-4 text-center text-muted-foreground`. (users-list·status-client·admin-history·override-panel 공통)

## Deps
없음.

## Steps

1. **`src/components/ui/table.tsx` 생성** — 엔트리포인트 §SC-1 `table.tsx` 코드를 그대로 작성한다. 설계 포인트:
   - `Table`: 스크롤 래퍼(`overflow-x-auto`) + 선택적 테두리(`bordered` 기본 true) + `<table className="w-full text-sm">`.
   - `TableBody`: `[&_tr]:border-t [&_tr]:border-border` 자식 선택자로 **본문 행에만** border 부여 → 헤더 행(thead 내부)은 border 없음(기존 visual과 동일).
   - `TableHead`(th)·`TableCell`(td) 기본 `p-2`.
   - `TableEmpty`: `colSpan` 필수, `p-4 text-center text-muted-foreground`.
   - 7개 named export: `Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty`.

2. **검증** (§SC-4): `npm run typecheck && npm run lint && npm run build`.

3. **commit** — `git add src/components/ui/table.tsx`.

## Acceptance Criteria
- typecheck/lint/build 모두 통과.
- 7개 컴포넌트 named export. 각 컴포넌트가 해당 네이티브 엘리먼트 props(`React.ComponentProps<...>`)를 패스스루.
- `bordered={false}` 전달 시 래퍼에 `rounded-lg border border-border`가 빠진다(Card 임베드용).

## Cautions
- **본문 행 border를 `TableRow`에 하드코딩하지 말 것. 이유:** 헤더 행도 `TableRow`로 쓰는데 헤더엔 border-t가 없어야 함. `TableBody`의 `[&_tr]` 선택자가 본문에만 적용돼 기존 visual을 정확히 재현한다.
- **정렬/페이지네이션/선택 등 기능을 넣지 말 것. 이유:** "최소 Table"이 범위. 슬롯만 제공.
- 소비처 미수정(신규 파일만). 이관은 task-06·07.
