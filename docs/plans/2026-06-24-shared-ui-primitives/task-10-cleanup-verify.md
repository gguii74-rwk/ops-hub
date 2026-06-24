# Task 10 — 구 Modal 삭제 + 최종 검증

소비처가 모두 `@/components/ui/modal`로 이관된 뒤 구 파일을 삭제하고 전체 게이트를 돌린다.

## Files
- **Delete:** `src/app/(app)/leave/_components/modal.tsx`

## Prep
- 전제: task-03(신규 Modal), task-06(approve-modal import 교체), task-07(create/edit-leave-modal import 교체) 완료.

## Deps
03, 06, 07.

## Steps

1. **잔존 importer 0 확인**(삭제 전 필수):
   ```
   grep -rn "leave/_components/modal\"\|from \"\./modal\"\|from \"\.\./modal\"" src
   ```
   - 결과가 **비어 있어야** 삭제 가능. 남아 있으면 해당 파일을 먼저 `@/components/ui/modal`로 교체(누락분).
   - (참고: `create-leave-modal`·`edit-leave-modal`·`leave-calendar`·`admin-history`는 **CreateLeaveModal/EditLeaveModal 래퍼**를 import — 이는 그대로 둔다. 삭제 대상은 base `modal.tsx`뿐.)

2. **구 파일 삭제:** `src/app/(app)/leave/_components/modal.tsx` 제거.

3. **전체 검증** (§SC-4 — 최종 게이트):
   ```
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```

4. **잔존 ad-hoc 패턴 스캔**(이관 누락 회귀 확인 — 0이어야 함, 제외 대상 빼고):
   ```
   grep -rn "selectCls" src                  # 0 이어야 함
   grep -rn "h-9 .*rounded-md border" src     # override-panel/기타 폼 잔재 0 (date input 포함 정리됨)
   ```
   - **예외(0이 아니어도 정상):** `matrix-editor.tsx`·`teams-editor.tsx`의 `<table>`(D2 제외), 그 외 의도적으로 남긴 bare 마크업.

5. **commit** — `git rm src/app/(app)/leave/_components/modal.tsx` 결과를 명시 stage(§SC-5).

## Acceptance Criteria
- `grep selectCls src` → 0건.
- 구 `modal.tsx` 부재, base Modal import는 전부 `@/components/ui/modal`.
- `npm run typecheck`·`lint`·`test`(기존 스위트 green 유지)·`build` 모두 통과.
- Table 이관 대상(users-list·admin-history·status-client·override-panel)에 bare `<table>` 잔존 0. `matrix-editor`·`teams-editor`는 의도적 잔존(D2).

## Cautions
- **CreateLeaveModal/EditLeaveModal/ApproveModal 등 래퍼 컴포넌트는 삭제하지 말 것**(base `modal.tsx`만 제거). 이유: 이들은 도메인 모달이며 base Modal을 소비.
- **importer가 남았는데 삭제하지 말 것.** 이유: 빌드 깨짐. step 1 grep이 비어야만 진행.
- 삭제 전 `git status`로 다른 세션 미커밋 변경이 섞이지 않았는지 확인(§SC-5).
