# Task 04 — States 3종 신설 (Loading/Error/Empty)

화면마다 복붙된 로딩·에러·빈상태 마크업을 대체할 공용 컴포넌트 신설.

## Files
- **Create:** `src/components/ui/states.tsx`

## Prep
- 읽기: 엔트리포인트 §SC-1 의 `states.tsx` 전체 코드(그대로 사용).
- 배경: 현 복붙 마크업 — 로딩 `<p className="text-sm text-muted-foreground">불러오는 중…</p>`, 에러 `<p className="text-sm text-destructive">불러오지 못했습니다.</p>`, 빈/권한없음 `<p className="text-sm text-muted-foreground">…</p>`.

## Deps
없음.

## Steps

1. **`src/components/ui/states.tsx` 생성** — 엔트리포인트 §SC-1 `states.tsx` 코드를 그대로 작성한다. 설계 포인트:
   - `LoadingState({ label?, className? })` — 기본 `label="불러오는 중…"`, 렌더 = `<p className="text-sm text-muted-foreground">`(기존과 visual 동일).
   - `ErrorState({ message?, className? })` — 기본 `message="불러오지 못했습니다."`, 렌더 = `<p className="text-sm text-destructive">{message}</p>`(기존과 visual 동일). **이벤트 핸들러 prop 없음**(서버 안전 유지 — RSC 경계). 재시도가 필요하면 client 소비처가 직접 처리.
   - `EmptyState({ children, action?, className? })` — `<p className="text-sm text-muted-foreground">{children}</p>` + 선택 `action`(빈화면을 행동 유도로). 기본은 기존 muted 문장과 동일.
   - 3개 named export.

2. **검증** (§SC-4): `npm run typecheck && npm run lint && npm run build`.

3. **commit** — `git add src/components/ui/states.tsx`.

## Acceptance Criteria
- typecheck/lint/build 통과.
- `LoadingState`·`ErrorState`·`EmptyState` named export.
- `ErrorState`/`LoadingState` 및 `EmptyState`(action 미전달) 렌더 시 기존 단일 `<p>` 마크업과 동일한 클래스(visual parity).
- states.tsx에 `"use client"`나 함수형 이벤트 핸들러 prop이 **없음**(서버 컴포넌트에서도 안전). `EmptyState.action`은 ReactNode만.

## Cautions
- **거대한 중앙정렬 일러스트/아이콘 블록으로 만들지 말 것. 이유:** 기존은 인라인 한 줄 muted 문장. visual parity 유지가 목표(미관 개편 아님).
- **`onRetry` 등 함수형 이벤트 핸들러 prop을 (다시) 추가하지 말 것. 이유:** states.tsx는 `"use client"` 없이 서버 페이지의 EmptyState로도 쓰여 서버 안전해야 한다. 함수 prop은 서버→클라이언트 직렬화 위반. 상호작용은 client 소비처에서.
- 소비처 미수정(신규 파일만). 로딩/에러/빈 마크업 치환은 task-06·07·09.
