---
name: review-loop
description: spec/plan/impl 단계 완료 후 변경을 커밋하고 codex 적대검증을 돌려, 보수적으로 자동수정하며 critical/high finding이 0이 될 때까지(최대 5회) 반복한다. 매 반복은 반드시 "커밋 후 리뷰" 순서. 5회 초과 또는 사용자 의사결정 사항은 사용자에게 넘긴다.
---

# review-loop

`/codex:adversarial-review`는 `disable-model-invocation: true`라 직접 호출할 수 없으므로, 동일한 companion 스크립트를 Bash로 실행한다.

**Announce:** "review-loop로 적대검증 반복을 시작합니다."

## 인자

- `--phase spec|plan|impl` (생략 시 변경 내용으로 추론)
- `--max <n>` (기본 5)
- `--base <ref>` (기본 `main`) — 적대검증이 보는 브랜치 diff 기준
- `--resume` — `.remember/remember.md`의 미완 루프 상태에서 이어서 시작

## 절차

### 0. resume 점검
`--resume`이거나 `.remember/remember.md`에 review-loop 미완 상태(phase/iteration/base/outstanding)가 있으면 복원한다. 없으면 iteration=1로 시작.

### 1. 사전 게이트 (phase=impl)
```bash
npm run typecheck && npm run lint && npm test && npm run build
```
실패하면 루프를 시작하지 말고 먼저 해결한다(systematic-debugging). 깨진 상태로 리뷰 금지.
phase가 spec/plan이면 게이트는 건너뛴다(문서 변경).

### 2. 반복 (iteration = 시작값..max)

#### 2a. 커밋 우선 — 핵심
작업 트리에 미커밋 변경이 있으면 의미 있는 메시지로 커밋한다(AI 서명 금지).
```bash
git add -A && git commit -m "<무엇을 했는지>"   # 변경 있을 때만
```
**이유: 적대검증은 커밋된 HEAD(브랜치 diff) 기준으로 본다. 미커밋이면 직전 수정을 놓친다.** 그래서 항상 "수정→커밋→리뷰" 순서.

#### 2b. 적대검증 실행 (entrypoint §SC-3)
```bash
ROOT=$(ls -d "$HOME"/.claude/plugins/cache/openai-codex/codex/*/ | sort -V | tail -1)
node "${ROOT}scripts/codex-companion.mjs" adversarial-review --wait --base <ref>
```
- 변경이 크면(여러 파일/디렉터리 단위) `run_in_background: true`로 띄우고 `/codex:status`로 폴링한다.
- 출력 JSON을 파싱한다: `{ verdict, summary, findings[{severity,...}], next_steps }`.
- 출력이 스키마와 다르면 루프를 멈추고 원문을 보고한다(추측 금지).
- companion이 미설치/미인증으로 실패하면 멈추고 `/codex:setup`을 안내한다(임의 수정 금지).

#### 2c. 종료 판정 (entrypoint §SC-1)
`severity ∈ {critical, high}` finding 개수가 0이면 → **성공 종료**. 4번으로.

#### 2d. 분류 (entrypoint §SC-2, 보수적)
critical/high를 AUTO / ESCALATE로 나눈다. medium/low는 요약에 기록만.

#### 2e. ESCALATE 처리
ESCALATE 큐가 있으면 `AskUserQuestion`으로 사용자 판단을 구한다(각 항목: 무엇이/왜/영향/선택지). 사용자의 결정을 반영한다. 사용자가 "지금 멈추고 직접 본다"를 택하면 핸드오프를 쓰고 종료한다.

#### 2f. AUTO 처리 (TDD)
각 AUTO finding을 TDD로 고친다: 재현/실패 테스트 → 최소 수정 → 게이트 통과. 가능하면 `superpowers:subagent-driven-development` 패턴을 쓴다.

#### 2g. 게이트 재실행
phase=impl이면 1번 게이트를 다시 통과시킨다. 깨지면 그 반복을 커밋하지 말고 원인부터 해결한다.

#### 2h. 횟수 한도
iteration > max(기본 5)이면 멈추고, 미해결 finding 요약 + "사용자 판단 필요"를 보고한 뒤 핸드오프를 쓰고 종료한다.

#### 2i. 컨텍스트 점검 (entrypoint §SC-4/SC-5)
컨텍스트 사용량이 ≥40%로 느껴지면(또는 Stop 훅이 넛지하면): `.remember/remember.md`에 핸드오프(phase/iteration/base/outstanding)를 쓰고, 사용자에게 "/clear 후 `/review-loop --resume`로 이어가세요"라고 안내한 뒤 이 세션의 루프를 종료한다. (자가 /clear 불가)

#### 2j. 다음 반복
iteration++ 하고 2a로 돌아간다(다음 반복도 커밋 후 리뷰).

### 3. (반복 끝의 커밋은 2a가 다음 반복 시작에 수행)

### 4. 종료 요약
보고: 총 반복 횟수, 자동수정 내역(finding→커밋), ESCALATE 처리/결정, 남은 medium/low, 최종 verdict.
단계 경계(spec→plan, plan→impl)면: 핸드오프를 쓰고 "다음 단계는 /clear 후 시작하세요 + <다음 단계 진입 안내>"를 덧붙인다.

## 종료 조건 요약
- ✅ critical=0 AND high=0 → 성공 종료
- ⏸ iteration > max(5) → 사용자 판단 대기
- ⏸ ESCALATE에서 사용자가 중단 선택 → 사용자 판단 대기
- ⏸ 컨텍스트 ≥40% → 핸드오프 + /clear 안내 후 종료(resume로 이어감)

## 하지 말 것
- medium/low를 이 루프에서 고치지 말 것(범위 밖, 잡음).
- 미커밋 상태로 적대검증 돌리지 말 것(직전 수정을 못 본다).
- ESCALATE 사항을 임의로 자동 수정하지 말 것(사용자 의사결정).
- 커밋 메시지에 AI 서명 넣지 말 것(글로벌 규칙).
