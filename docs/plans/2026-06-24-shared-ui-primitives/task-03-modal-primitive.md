# Task 03 — Modal 승격(+저위험 a11y)

`leave/_components/modal.tsx`를 `src/components/ui/modal.tsx`로 승격하고 Escape·aria·scroll-lock + focus 관리 추가(D3).

## Files
- **Create:** `src/components/ui/modal.tsx`
- **Create:** `tests/components/ui/modal.test.tsx` — Modal 동작 jsdom 테스트(D4 부분 예외)
- **Modify:** `vitest.config.ts`(include에 `.test.tsx` 추가), `package.json`(devDep `@testing-library/react`·`jsdom`)
- (구 `src/app/(app)/leave/_components/modal.tsx`는 **이 task에서 삭제하지 않음** — 소비처 이관 후 task-10에서 삭제. 신·구 공존 허용)

## Prep
- 읽기: 엔트리포인트 §SC-1 의 `modal.tsx` 전체 코드(그대로 사용), §SC-0 D3·D4(Modal 테스트 예외).
- 대조: 현 `src/app/(app)/leave/_components/modal.tsx`(승격 원본 — 마크업·className 동일하게 보존), `vitest.config.ts`(현 `environment: "node"`, include `tests/**/*.test.ts`·`src/**/*.test.ts`).

## Deps
없음(프리미티브 코드). 단 이 task가 devDep `@testing-library/react`(React 19 호환)·`jsdom`을 추가한다.

## Steps

1. **`src/components/ui/modal.tsx` 생성** — 엔트리포인트 §SC-1 `modal.tsx` 코드를 그대로 작성한다. 원본 대비 추가분만:
   - `"use client"` 유지(effect 사용).
   - `useId()`로 `titleId` 생성 → `<h2 id={titleId}>` + **Card에** `role="dialog"`·`aria-modal="true"`·`aria-labelledby={titleId}`(overlay 아님 — focus 대상 = 명명된 dialog 일치).
   - `useRef`로 최신 `onClose` 보관 + `useEffect(() => {...}, [])`(mount 1회): `keydown`에서 `Escape` → `onClose`, body `overflow:hidden` 잠금 + cleanup에서 원복.
   - **focus 관리**(D3): `cardRef`(`useRef<HTMLDivElement>`)를 `Card`에 전달(dialog 시맨틱 + `tabIndex={-1}`·`outline-none`을 모두 Card에) → 열 때 `card.focus()`로 focus가 **role=dialog 요소**에 안착(**폼 필드 auto-focus 안 함**), `Tab`/`Shift+Tab`에서 첫·마지막 focusable 사이를 트랩, cleanup에서 `prevActive?.focus?.()`로 직전 focus 복원. focusable 셀렉터는 SC-1 코드의 `FOCUSABLE` 그대로.
   - **마크업·className·overlay 클릭 닫기·stopPropagation·✕ 버튼은 원본 그대로** 보존(변경분: dialog 시맨틱(role/aria-modal/aria-labelledby)을 overlay→**Card**로 이동 + `ref`·`tabIndex`·`outline-none` 추가).

2. **테스트 인프라(최소 예외, D4)** — 전역 환경은 node 유지, 이 한 파일만 jsdom:
   - devDep 추가: `npm i -D @testing-library/react jsdom`(react-dom은 이미 존재; `@testing-library/react`는 React 19 호환 버전).
   - `vitest.config.ts`의 `include` 배열에 `"tests/**/*.test.tsx"` 추가(기존 `tests/**/*.test.ts`·`src/**/*.test.ts` 유지 → 기존 1282 node 테스트 영향 없음, 전역 `environment: "node"` 그대로).

3. **`tests/components/ui/modal.test.tsx` 작성** — 최상단 `// @vitest-environment jsdom` 도크블록(이 파일만 jsdom). `@testing-library/react`의 `render`로 `<Modal title=… onClose={spy}>…children(폼/버튼)…</Modal>` 렌더 후 검증:
   - `Escape` keydown → `onClose` 1회 호출.
   - overlay(바깥 div) 클릭 → `onClose` 호출(기존 동작 보존), Card 내부 클릭 → 호출 안 됨(stopPropagation).
   - 렌더 중 `document.body.style.overflow === "hidden"`, 언마운트 후 이전 값으로 복원.
   - 열 때 `document.activeElement`가 **`role="dialog"`이고 accessible name = title**(예: `getByRole("dialog", { name: title })`가 focus 요소와 동일), `Tab`/`Shift+Tab`이 첫·마지막 focusable 경계를 벗어나지 않음(트랩).
   - 마운트 전 focus했던 요소가 언마운트(닫기) 후 다시 focus(복원).

4. **검증** (§SC-4): `npm run typecheck && npm run lint && npm test && npm run build`(신규 modal 테스트 포함 green).

5. **commit** — `git add src/components/ui/modal.tsx tests/components/ui/modal.test.tsx vitest.config.ts package.json package-lock.json`.

## Acceptance Criteria
- typecheck/lint/build 통과.
- `Modal({ title, onClose, children })` named export. props 시그니처 = 원본과 동일(소비처 무변경 호환).
- 추가된 동작: Escape 닫기, `aria-labelledby` 연결, 열림 동안 body scroll-lock(+cleanup 원복).
- focus 관리: 열 때 **role=dialog(명명된) 요소(Card)** 에 focus, `Tab`/`Shift+Tab`이 모달 내부를 벗어나지 않음(트랩), 닫을 때 직전 focus 복원. **폼 필드로 initial-focus 이동은 없음**.
- `tests/components/ui/modal.test.tsx`(jsdom)가 Escape 닫기·overlay 클릭·scroll-lock cleanup·Tab 트랩·focus 복원·**focus 요소가 role=dialog + title 이름 일치**를 검증하고 `npm test`에서 green. 전역 vitest 환경은 node 유지(이 파일만 `// @vitest-environment jsdom`), 기존 테스트 회귀 0.

## Cautions
- **폼 필드로의 initial-focus 자동이동은 넣지 말 것. 이유:** D3 — 내부 폼 입력 포커스와 충돌해 회귀 위험. focus는 **dialog 요소(Card)** 에만 두고, Tab 트랩·복원만 제공한다(컨테이너 focus + 트랩 + 복원은 도입).
- **dialog 시맨틱(role/aria-modal/aria-labelledby)을 overlay(backdrop)에 두지 말 것. 이유:** focus 대상(Card)과 명명된 dialog가 어긋나 스크린리더가 이름 없는 div에 안착. role/aria/ref/tabIndex/focus를 **모두 Card**에 둔다.
- **전역 vitest `environment`를 jsdom으로 바꾸지 말 것. 이유:** 기존 1282개는 node 전제. Modal 테스트만 파일별 도크블록으로 jsdom 적용(D4 예외 범위 = Modal 1개). include에 `.test.tsx`만 추가.
- **`useEffect` 의존성에 `onClose`를 직접 넣지 말 것. 이유:** 소비처가 인라인 화살표로 매 렌더 새 함수를 전달 → 리스너 재등록·scroll-lock 재설정 반복. `onCloseRef` + `[]`로 mount 1회만.
- **props 시그니처를 바꾸지 말 것**(title/onClose/children). 이유: approve-modal·create/edit-leave-modal가 그대로 호출.
