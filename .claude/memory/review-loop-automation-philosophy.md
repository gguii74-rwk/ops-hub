---
name: review-loop-automation-philosophy
description: "사용자는 자동화 워크플로에서 사람 개입을 병목으로 보고 최소화를 강하게 선호 — 자동수정은 가급적 무인, 사람은 위험군 결정만"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 78226ad7-bd24-4dc5-8e92-e499b40db80a
---

ops-hub의 review-loop(spec/plan/impl 적대검증 반복) 같은 개발 자동화를 설계할 때, 사용자는 "사람이 워크플로의 가장 큰 병목"이라는 전제로 사람 개입 최소화를 우선한다.

**Why:** 매 리뷰마다 사람이 개입하면 방향성은 맞지만 시간 효율이 떨어진다. 자동 수정 가능한 것은 무인으로 돌리고, 사람의 판단은 꼭 필요한 곳(위험군)에만 모으는 것이 핵심 가치.

**How to apply:** 자동화 설계 시 (1) 자동 가능한 수정은 초반 라운드에서 무인 처리(review-loop `--auto-rounds`, 기본 3), (2) 사람 결정이 필요한 ESCALATE는 batch로 모아 단계 경계에서 한 번에 제시, (3) 단 critical·보안/데이터·후속 전제가 되는 방향 결정은 즉시 제시(잘못된 토대 누적 방지). 단순 "무조건 자동"이 아니라 "위험군만 사람"이 사용자의 균형점. 관련: [[session-per-merge-workflow]].
