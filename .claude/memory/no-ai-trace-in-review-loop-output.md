---
name: no-ai-trace-in-review-loop-output
description: review-loop 산출물(plan 문서·커밋 메시지)에 codex/AI 도구 출처를 적지 말 것 — 운영 프로젝트 no-AI-trace 규칙
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6f08055e-2202-44f0-806e-79404550dc26
---

운영 프로젝트(ops-hub 등)에서는 글로벌 규칙상 **AI 흔적을 남기지 않는다**. review-loop를 돌릴 때 finding 근거를 적으며 "codex R1 반영", "codex R3" 같은 **도구 출처를 plan 문서·커밋 메시지에 적는 습관**이 이 규칙을 위반한다(2026-06-24 shared-ui-primitives plan에서 R1~R4 수정 시 반복 위반 → R5 적대검증이 적발).

**Why:** 이런 출처 표기는 git history에 영구히 남아 다운스트림 문서로 복제되고, 운영 프로젝트의 no-AI-trace 정책을 깬다. codex 커밋 메시지 AI 서명 금지 규칙과 동일 취지.

**How to apply:** finding을 닫을 때는 **기술적 근거만** 쓰고 도구명(codex/Claude/AI)은 쓰지 않는다(예: "codex R1 반영" ✗ → "aria-modal인데 focus 미관리 문제 반영" ✓). 커밋 메시지도 "codex Rn FIXED" ✗ → 무엇을 왜 고쳤는지만. 종료 시 `grep -riE "codex|claude|co-authored"`로 plan·커밋 0 확인. 단 `CLAUDE.md` 파일 인용·"AI 서명 금지" 같은 위생 지시는 출처가 아니므로 예외. 로컬 전용 브랜치면 squash로 메시지까지 정리 가능. [[session-per-merge-workflow]] [[review-loop-automation-philosophy]]
