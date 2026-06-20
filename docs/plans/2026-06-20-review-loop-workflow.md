# 적대검증 반복 루프 + 컨텍스트 규율 워크플로우 — 구현 계획 (entrypoint)

- 설계: `docs/specs/2026-06-20-adversarial-review-loop-workflow-design.md`
- Goal: spec/plan/impl 단계 완료 후 "커밋→적대검증→보수적 자동수정→재반복(critical/high 0까지/5회)"을 도구화하고, 컨텍스트 40% 시 핸드오프/`/clear`를 넛지한다.
- Architecture: 집중 `review-loop` 스킬(절차) + `transcript usage` 기반 컨텍스트 임계 Stop 훅(스크립트+settings) + 런북 문서. 모두 git 추적으로 양 노트북 공유. 기존 superpowers 스킬·글로벌 설정·claude-hud는 건드리지 않는다.
- Tech Stack: Node ESM(`.mjs`) 훅 스크립트, vitest(`tests/**/*.test.ts`), Claude Code 훅/스킬, codex 플러그인 companion.

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-20-review-loop-workflow/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

## Shared Contracts

2개 이상 태스크가 참조하는 계약. 태스크 파일은 재인라인 대신 "entrypoint §SC-n"으로 가리킨다.

### SC-1 종료·심각도 규칙
- finding `severity ∈ {critical, high, medium, low}`.
- 루프 **성공 종료 = critical 개수 0 그리고 high 개수 0**. (high만 보면 critical을 흘릴 수 있음)
- medium/low = 요약에 기록만, 이 루프에서 수정하지 않음.

### SC-2 분류(triage) 규칙 — 보수적
각 critical/high finding을 둘 중 하나로 분류한다.
- **AUTO(자동수정)**: 수정 방향이 명확 — 버그, 누락 가드, 테스트 공백, 경쟁조건/원자성, 잘못된 권한 검사 등.
- **ESCALATE(사용자 의사결정)**: 다음 중 하나라도 해당 — (a) 제품 범위/동작(UX·정책) 변경, (b) 설계 spec 의도에 반함(스펙 변경 필요), (c) 유효한 설계 선택지가 둘 이상, (d) 보안·데이터 트레이드오프 판단 필요, (e) finding confidence가 낮음(불확실).

### SC-3 adversarial-review companion 호출
- 플러그인 루트 탐지(버전 하드코딩 금지): `ls -d "$HOME"/.claude/plugins/cache/openai-codex/codex/*/ | sort -V | tail -1`
- 실행: `node "<root>/scripts/codex-companion.mjs" adversarial-review --wait --base <ref>` — 변경 규모가 크면 `run_in_background`로 띄우고 폴링.
- 출력(JSON, `schemas/review-output.schema.json`):
  ```
  verdict: "approve" | "needs-attention"
  summary: string
  findings[]: { severity, title, body, file, line_start, line_end, confidence(0..1), recommendation }
  next_steps[]: string
  ```

### SC-4 컨텍스트 임계 훅 계약 + 상수
- **used** = (마지막 assistant 메시지의) `usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens`.
- **한도(limit)**: 그 메시지 `model`에 `[1m]` 포함 → `1_000_000`, 아니면 `200_000`. env `OPS_HUB_CTX_LIMIT`(양수)로 override.
- **임계(threshold)**: 기본 `0.40`. env `OPS_HUB_CTX_THRESHOLD`(0<t<1)로 override.
- **훅 입력**(Stop 훅 stdin JSON): `{ transcript_path, session_id, stop_hook_active }`.
- **훅 출력**: 넛지 시 `{"decision":"block","reason":<핸드오프+/clear 지시>}`, 그 외 exit 0. `stop_hook_active===true` 또는 세션 넛지 플래그 존재 시 exit 0(무한·중복 방지).

### SC-5 핸드오프 / resume 상태
- `.remember/remember.md`에 작성(기존 remember 포맷). review-loop 재개에 필요한 최소 상태를 명시: `phase / iteration / base / outstanding findings(file·line·severity·요약)`.
- 새 세션에서 `/review-loop --resume`가 이 상태를 읽어 iteration·미해결 finding을 복원한다.

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 컨텍스트 임계 훅 스크립트 + 테스트 | [ ] | [task-01](2026-06-20-review-loop-workflow/task-01-context-hook.md) | — | |
| 02 | 프로젝트 settings.json Stop 훅 등록 | [ ] | [task-02](2026-06-20-review-loop-workflow/task-02-settings-registration.md) | 01 | |
| 03 | review-loop 스킬 | [ ] | [task-03](2026-06-20-review-loop-workflow/task-03-review-loop-skill.md) | — | |
| 04 | 런북 문서 + 인덱스 | [ ] | [task-04](2026-06-20-review-loop-workflow/task-04-runbook-doc.md) | — | |

## 검증(전체)

- `npm test` — 훅 스크립트 단위 테스트 통과(Task 01).
- `npm run typecheck` — 테스트가 `.mjs` 훅을 import해도 통과(allowJs).
- settings.json 유효 JSON + Stop 훅 엔트리 존재(Task 02).
- review-loop SKILL.md / 런북 자기완결(Task 03·04).
