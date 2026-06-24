---
name: dev-workflow-plugin
description: review-loop·writing-plans-split·context-threshold-hook을 dev-workflow 플러그인으로 패키징해 public repo로 배포; ops-hub 전환 PR #17(2026-06-24, 머지 대기)
metadata: 
  node_type: memory
  type: project
  originSessionId: 09af219f-a87c-474a-b408-ac69870dd470
---

개발 워크플로 도구 3종(`review-loop`·`writing-plans-split` 스킬 + 컨텍스트 임계 Stop 훅)을 단일 Claude Code 플러그인 **`dev-workflow`**로 묶어, 다른 프로젝트·두 노트북·장래 팀원이 재사용하도록 배포했다(2026-06-23).

- **repo (PUBLIC)**: `github.com/gguii74-rwk/claude-dev-workflow`. 구조 = marketplace는 repo 루트 `.claude-plugin/marketplace.json`, plugin은 `dev-workflow/` 서브디렉터리(표준 패턴; relative source `"./dev-workflow"`는 git 경유 add에서만 동작).
- **설치(최초 1회, 각각 실행)**: `/plugin marketplace add gguii74-rwk/claude-dev-workflow` → `/plugin install dev-workflow@claude-dev-workflow`. codex marketplace 미등록 시 앞에 `/plugin marketplace add openai/codex-plugin-cc` 한 줄 추가.
- **codex 의존**: `plugin.json`의 `dependencies`에 `codex@openai-codex`(cross-marketplace) 선언 + `marketplace.json`에 `allowCrossMarketplaceDependenciesOn:["openai-codex"]`. codex 플러그인은 자동 설치되나 **codex CLI 인증(`/codex:setup`)은 별도**.
- **일반화**: 훅 내부 env/flag 이름 `OPS_HUB_CTX_*`→`CLAUDE_CTX_*`, prefix `claude-ctx-nudge`. hooks.json은 env 미전달 → 모델명 `[1m]` 자동감지로 limit 결정. `writing-plans-split` description의 ops-hub 게이트 해제.

**ops-hub 전환 완료 → PR #17**(2026-06-24, 브랜치 `chore/adopt-dev-workflow-plugin`, 머지 대기): ops-hub `.claude/settings.json`을 `extraKnownMarketplaces`(claude-dev-workflow + openai-codex) + `enabledPlugins(dev-workflow@claude-dev-workflow)` 선언으로 교체, 로컬 `.claude/skills/{review-loop,writing-plans-split}`·`scripts/context-threshold-hook.mjs`·Stop훅 제거, 동반 orphan `tests/scripts/context-threshold-hook.test.ts` 제거(test 1271 passed·typecheck clean), CLAUDE.md·`docs/workflow/review-loop-runbook.md` 참조를 `dev-workflow:*`로 갱신(hook env `OPS_HUB_CTX_*`→`CLAUDE_CTX_*`). 스킬 호출명이 `dev-workflow:review-loop`·`dev-workflow:writing-plans-split`로 바뀌고 **새 세션부터** 노출됨. `docs/plans|specs/2026-06-20-*`의 옛 경로는 동결 historical이라 미수정. 관련: [[review-loop-automation-philosophy]] [[session-per-merge-workflow]]
