---
name: shared-ui-primitives-pr
description: 공용 UI 프리미티브 5종 신설+소비처 이관 SDD 완료 → PR #18 머지 완료(cbb54c8, 2026-06-24)
metadata:
  type: project
---

공용 UI 프리미티브 고정(system layer) 구현 완료 → **PR #18 머지 완료**(머지 커밋 cbb54c8, 2026-06-24, 브랜치 `feat/shared-ui-primitives` HEAD 5483322, 11 커밋, merge commit 컨벤션). dev 배포는 미진행(표준 `npm ci`→`build`→`pm2 restart` — 마이그레이션 없음).

`subagent-driven-development`로 10 태스크 실행(구현자→task 리뷰어 게이트 매 태스크). 신설 5종(`src/components/ui/`): Select·Table·Modal(+a11y: focus 트랩·Escape·scroll-lock, dialog 시맨틱은 Card에·폼 auto-focus 제외)·States(서버안전, 함수 prop 없음)·PageHeader/PageSection. 소비처 이관: admin/users 6 + leave 7 + navigation/signup select 4 + page.tsx 11 타이틀 통일, 구 base modal 삭제.

설계 결정(plan SC-0): D1 Select=Input 정렬(폼 select h-9→h-8 의도). D2 matrix-editor·teams-editor 이관 제외(이관 후 `grep "<select" src` 3건[matrix 2·teams 1] 잔존=정상). D4 프리미티브는 정적 게이트+육안, **Modal만 jsdom 동작 테스트 1파일**(전역 vitest env=node 유지, devDep `@testing-library/react`·`jsdom` 추가). D5 타이틀 정규화(text-xl 드리프트→`font-display text-2xl`).

게이트: typecheck 0·lint 0·test **1279/1279**(Modal +8)·build 53 pages. 최종 whole-branch 리뷰(opus) **Ready to merge = YES**(Critical/Important 0). **배포 노트: 스키마/DB 마이그레이션 없음 — 표준 `pm2 restart`로 충분**(full-stop 불요, teams PR과 대비).

머지 시 [[session-per-merge-workflow]]대로 새 세션. 머지 전 origin==local HEAD 확인(이미 push·일치). [[no-ai-trace-in-review-loop-output]] 준수(plan·커밋·PR 본문 AI 흔적 0, grep 확인). [[ops-hub-palette-direction]] 불변(미관 개편 아님).
