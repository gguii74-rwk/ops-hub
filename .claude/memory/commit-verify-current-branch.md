---
name: commit-verify-current-branch
description: 커밋/푸시 전 git branch --show-current로 현재 브랜치 확인 (두 노트북 교대로 예고 없이 바뀔 수 있음)
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ea14d77f-b0e4-4e9f-a933-df11ba31626a
---

이 작업 환경은 두 노트북 교대 + 다른 세션이 예고 없이 다른 브랜치를 checkout해둘 수 있다. 실제로 `feat/phase-5-leave`에서 시작한 세션이 중간에 `feat/review-loop-workflow`로 바뀐 채, leave 커밋이 엉뚱한 브랜치에 들어가고 `push -u origin feat/phase-5-leave`가 옛 로컬 브랜치를 올려 변경이 의도한 브랜치/원격에서 누락된 사고가 있었다(2026-06-20).

**Why:** 잘못된 브랜치에 커밋되고 엉뚱한 브랜치를 push하면, 변경이 의도한 브랜치/원격에서 빠지고 두 브랜치 히스토리가 섞인다.

**How to apply:** `git commit`/`git push` 직전 `git branch --show-current`로 현재 브랜치를 확인하고, 의도한 브랜치와 다르면 checkout 후 진행한다. 복구는 cherry-pick(올바른 브랜치로 내용 이동) + `git branch -f <branch> <원격HEAD>`(잘못 얹힌 커밋 제거)로 무손실 처리 가능.

관련: [[session-per-merge-workflow]]
