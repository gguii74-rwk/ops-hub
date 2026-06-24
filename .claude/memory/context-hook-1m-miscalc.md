---
name: context-hook-1m-miscalc
description: "dev-workflow 컨텍스트 임계 훅의 1M 감지 실패 원인·해결 — transcript에 [1m] 라벨이 없음"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6f08055e-2202-44f0-806e-79404550dc26
---

dev-workflow `context-threshold-hook.mjs`가 1M 컨텍스트를 `/\[1m\]/i.test(model)`로 감지하는데, **transcript의 `message.model`은 베어 ID `claude-opus-4-8`만 담고 `[1m]` 접미사는 Claude Code 화면 라벨에만 존재**한다(베타 1M 활성 여부가 transcript 어디에도 기록 안 됨). 그래서 감지 실패→limit이 1M 아닌 200k로 폴백→사용량 비율이 **정확히 5배(1M÷200k) 부풀려짐**(예: 실제 13%인데 훅이 58%로 넛지). used = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.

**해결(2026-06-24):**
- 플러그인 v0.1.1(`claude-dev-workflow` main `7cc14b9`): `peakUsed > 200k면 1M 자기보정` 추가. **단 200k 미만 1M 세션은 transcript 신호가 없어 원천 자동감지 불가**.
- 그래서 `CLAUDE_CTX_LIMIT=1000000` env 오버라이드가 실질 해결책. ops-hub는 `.claude/settings.local.json`(gitignored)에 둠 — repo 전역(`settings.json`) 강제는 실제 200k 세션을 과소경고시켜 위험하므로 피함.

**재발/이식 시:** 1M 세션인데 훅이 과도하게 일찍 넛지하면 `CLAUDE_CTX_LIMIT` 미설정 의심. 두 노트북 각각 `settings.local.json` 수동 설정 필요(git-sync 안 됨). 플러그인 캐시 반영은 `/plugin` 업데이트+세션 재시작. [[dev-workflow-plugin]]
