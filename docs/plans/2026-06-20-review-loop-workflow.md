# 적대검증 반복 루프 + 컨텍스트 규율 워크플로우 — 구현 계획 (entrypoint)

- 설계: `docs/specs/2026-06-20-adversarial-review-loop-workflow-design.md`
- Goal: spec/plan/impl 단계 완료 후 "커밋→적대검증→보수적 판정·자동수정→재반복(미판정 blocking 0까지/최대 5회)"을 도구화하고, 컨텍스트 40% 시 핸드오프/`/clear`를 넛지한다.
- Architecture: 집중 `review-loop` 스킬(절차) + `transcript usage` 기반 컨텍스트 임계 Stop 훅(스크립트+settings) + 런북 문서. 모두 git 추적으로 양 노트북 공유. 기존 superpowers 스킬·글로벌 설정·claude-hud는 건드리지 않는다.
- Tech Stack: Node ESM(`.mjs`) 훅 스크립트, vitest(`tests/**/*.test.ts`), Claude Code 훅/스킬, codex 플러그인 companion.

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-20-review-loop-workflow/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

## Shared Contracts

2개 이상 태스크가 참조하는 계약. 태스크 파일은 재인라인 대신 "entrypoint §SC-n"으로 가리킨다.

### SC-1 종료·심각도 규칙
- finding `severity ∈ {critical, high, medium, low}`. blocking severity = critical/high/medium.
- 모든 blocking finding은 **disposition**으로 닫는다: FIXED / ACCEPTED / DEFERRED_TO_IMPL / OUT_OF_SCOPE / DUPLICATE / ESCALATE. low = `DEFER_LOW`.
- **미판정(unadjudicated) blocking** = critical/high/medium 중 disposition 없는 것 + FIXED 재확인 대기.
- 루프 **성공 종료 = 미판정 blocking 개수 0**. 목표는 "high 0"이 아니라 "판정 없이 남은 high 0". (low·판정완료 항목만 남는다)
- **판정 루프 전환**: blocking score(critical=4·high=3·medium=1)가 2회 연속 감소하지 않으면(정체/발산) 수정 루프를 멈추고 판정 루프로 전환(남은 미판정을 ledger에 닫음). count가 아닌 score로 본다.

### SC-2 분류·판정(disposition) 규칙 — 보수적
각 critical/high/medium finding에 disposition을 부여해 ledger에 닫는다(low는 `DEFER_LOW`).
- **FIXED**: 수정 방향이 명확 — 버그·누락 가드·테스트 공백·경쟁조건/원자성·잘못된 권한 검사 등.
- **ACCEPTED**: 실제 위험이나 현 단계에서 의도적 수용(이유+보완 명시).
- **DEFERRED_TO_IMPL**: spec/plan에서 못 닫음 → impl plan의 AC/테스트로 이전·연결(spec/plan 전용).
- **OUT_OF_SCOPE**: 이번 변경 범위 밖(follow-up). **DUPLICATE**: 기존 ledger 항목과 동일.
- **ESCALATE(사용자 의사결정)**: (a) 제품 범위/동작(UX·정책) 변경, (b) 설계 spec 의도에 반함, (c) 유효 설계 선택지 2+, (d) 보안·데이터 트레이드오프, (e) confidence 낮음 — 하나라도 해당. 사용자가 FIXED/ACCEPTED/DEFERRED/OOS 중 하나로 닫는다.
- **ESCALATE 제시 시점(`--auto-rounds`, 기본 3)**: 초반 자동 라운드는 즉시군(critical·보안/데이터·후속 전제가 되는 방향결정)만 즉시 묻고, batch군은 모아 일괄 제시(score 정체 시 조기 전환). 자동 라운드 후(>auto-rounds)엔 매 라운드 즉시.
- 종료 판정은 **분류·판정·ESCALATE 처리 후**에 한다. FIXED 수정 단계는 phase 분기: impl=TDD, spec/plan=문서 수정 후 관문 재확인 + 문서 내부 정합성 자체 점검.
- **fingerprint**: `file`+정규화 `title`+`recommendation`(severity 제외, line 보조)로 신규/잔존/해결/중복을 대조. 같은 계열 2회 이상 반복 시 더 고치지 말고 판정으로 닫는다.

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
- `.remember/remember.md`에 작성(기존 remember 포맷). review-loop 재개에 필요한 최소 상태를 명시: `phase / iteration / base / ledger(file·severity·disposition·fingerprint·근거) / blocking score 이력`.
- 새 세션에서 `/review-loop --resume`가 이 상태를 읽어 iteration·ledger·score 이력을 복원한다.

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
