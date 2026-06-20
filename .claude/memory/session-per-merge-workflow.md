---
name: session-per-merge-workflow
description: ops-hub는 한 단계(머지 단위)마다 머지 후 새 세션에서 다음 단계를 시작하는 방식으로 진행
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9762149d-bd3b-4969-9da3-5a725c7ad750
---

사용자는 ops-hub 작업을 **단계별 머지 경계**로 끊어 진행한다. 한 단계를 완료·머지하면 **새 세션을 열어** 다음 단계를 시작한다 (2026-06-18 명시).

**Why:** 단계마다 컨텍스트를 깨끗이 리셋해 누적 오염을 피하고, 두 노트북 git 동기화 워크플로(오멘/그램)와도 맞물린다. 각 세션 ≈ 하나의 머지 가능한 작업 단위.

**How to apply:**
- 각 세션을 **하나의 머지 가능한 단위**로 보고, 깔끔한 머지 경계(PR 머지)까지 끌고 간 뒤 마무리한다. 한 세션에 여러 단계를 욱여넣지 않는다.
- 세션 종료 전 **`.remember/remember.md` 핸드오프를 항상 최신화** — 다음 세션은 fresh 컨텍스트로 시작하므로 핸드오프 + SDD 원장(`.git/sdd/progress.md`) + git 히스토리만이 인계 수단이다. 세션 내 대화 맥락의 연속성을 가정하지 말 것.
- 머지 직후 새 세션이면, 직전 세션의 결과(머지된 main 상태)를 git/핸드오프에서 먼저 확인하고 시작한다.
- 관련: 다음 예정 단계는 [[ops-hub-vibrant-palette-direction]] (브랜드 팔레트 패스).
