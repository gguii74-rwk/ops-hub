---
name: nav-accordion-merged
description: 사이드바 단일확장 아코디언(현재위치 보호=모델2)+부모클릭 첫 중메뉴 이동 PR
metadata: 
  node_type: memory
  type: project
  originSessionId: cfe215fe-efc7-401b-abdf-2ad5fe9d0532
---

사이드바 메뉴 동작 2건 수정 → **PR #20 머지(merge commit 348331c) + kgs-dev 배포 완료**(2026-06-24, test 1302, review-loop 3R approve, smoke login 200·dashboard 307).

- **이슈1 부모 클릭 → 첫 중메뉴 이동**: `computeNavRows`에 `targetHref` 추가. href 있는 부모는 첫 자식 href로(관리 → /admin/users). **href=null 부모(권한 필터된 그룹, D5)는 비링크 유지**.
- **이슈2 트리 일관성**: 펼침 state를 NavRowView 로컬 useState → AppNav 단일 `expandedKey`로 끌어올림. 근본원인=사이드바가 레이아웃이라 라우팅 시 리마운트 안 됨 → open이 stuck.
- **UX 모델2(사용자 확정)**: 활성 섹션 **항상 펼침·접기 불가**(현재 위치 보호) + 비활성 1개 수동 미리보기 공존(최대 2개). 경로 이동 시 수동 펼침 클리어.

[[sidebar-tree-submenu-merge-ready]]의 후속(메뉴 트리 동작 다듬기). /admin placeholder는 사이드바로 도달 불가가 됨(직접 URL만, 무해).
