# Task 04 — 런북 문서 + 인덱스

목적: brainstorming → writing-plans-split → subagent-driven-development 사이에 review-loop와 `/clear` 지점을 어떻게 끼우는지 런북으로 적고, CLAUDE.md에 짧은 포인터를 둔다.

## Files

- Create: `docs/workflow/review-loop-runbook.md`
- Modify: `CLAUDE.md` (짧은 포인터 1개 섹션 추가)

## Prep

- spec §4.3(단계 경계 규율), entrypoint §SC-1·SC-5.
- CLAUDE.md에는 "## 구현 계획 작성" 섹션이 끝부분에 있음 — 그 뒤에 새 섹션을 surgical하게 추가.

## Deps

없음(03 스킬을 가리키지만 문서라 독립 작성 가능).

## Steps

### 1) `docs/workflow/review-loop-runbook.md` 작성 — 아래 전체 내용 그대로

```markdown
# 개발 사이클 런북: 적대검증 반복 + 컨텍스트 규율

설계: `docs/specs/2026-06-20-adversarial-review-loop-workflow-design.md`

## 한 phase의 end-to-end

각 단계는 **별도 세션**에서 시작한다(단계 경계 = 반드시 컨텍스트 초기화).

```
[spec]  superpowers:brainstorming → spec 작성·커밋
        → /review-loop --phase spec
        → (critical/high 0) 핸드오프 작성 + "다음은 /clear 후 plan" 안내
        → 사용자가 /clear

[plan]  (새 세션) writing-plans-split → plan 작성·커밋
        → /review-loop --phase plan
        → (통과) 핸드오프 + "다음은 /clear 후 impl" 안내
        → 사용자가 /clear

[impl]  (새 세션) superpowers:subagent-driven-development → 구현·커밋
        → /review-loop --phase impl --base main
        → (통과) superpowers:finishing-a-development-branch
```

## review-loop 한눈에

- 매 반복 = **커밋 → 적대검증(커밋된 HEAD 기준) → 보수적 분류 → TDD 수정 → 재반복**.
- 종료: critical=0 AND high=0. 5회 초과 또는 사용자 의사결정 사항이면 멈추고 사용자 대기.
- 보수적 수용/비수용 기준은 `review-loop` 스킬과 plan §SC-2 참조.

## 컨텍스트 규율(자동/수동 경계)

- **자동**: Stop 훅(`scripts/context-threshold-hook.mjs`)이 transcript 사용량을 계산해 40% 초과 시 "핸드오프 쓰고 /clear 안내"를 1회 넛지. review-loop도 같은 시점을 자체 점검.
- **수동(원리적 한계)**: 실제 `/clear` 입력은 사람이 한다. 자가 `/clear`·자동 단계전환은 Claude Code가 지원하지 않는다(설계 §2).
- 임계 조정: env `OPS_HUB_CTX_THRESHOLD`(0~1), 한도 override `OPS_HUB_CTX_LIMIT`.

## 왜 완전 무인이 아닌가
- 모델/훅은 자기 세션을 `/clear` 할 수 없다.
- 훅은 슬래시 커맨드/스킬을 호출하지 못한다(넛지만 가능).
- 그래서 "감지·반복·수정은 자동, /clear와 중요 의사결정은 사람"으로 설계했다.
```

### 2) `CLAUDE.md`에 포인터 섹션 추가

"## 구현 계획 작성" 섹션 **바로 뒤**에 아래를 추가한다(기존 문구 변경 없음, 새 섹션만 삽입):

```markdown
## 개발 사이클 자동화 (적대검증 반복 루프)

각 단계(spec/plan/impl) 완료 후 `review-loop` 스킬로 "커밋→codex 적대검증→보수적 자동수정→재반복(critical/high 0까지/최대 5회)"을 돌린다. 단계 경계(spec→plan, plan→impl)는 **반드시 새 세션**에서 시작한다(핸드오프 작성 후 `/clear`). 컨텍스트 40% 초과 시 Stop 훅(`scripts/context-threshold-hook.mjs`)이 핸드오프+`/clear`를 넛지한다. 자가 `/clear`·자동 단계전환은 불가하므로 실제 초기화는 사람이 한다. 상세: `docs/workflow/review-loop-runbook.md`.
```

### 3) 커밋
```bash
git add docs/workflow/review-loop-runbook.md CLAUDE.md
git commit -m "docs(workflow): 개발 사이클 런북 + CLAUDE.md 포인터"
```

## Acceptance Criteria

- `docs/workflow/review-loop-runbook.md` 존재 + end-to-end 흐름/컨텍스트 규율/자동·수동 경계 포함.
- `CLAUDE.md`에 "개발 사이클 자동화" 섹션 1개 추가, 기존 내용은 변경 없음.
- 런북이 review-loop 스킬·Stop 훅·spec을 모두 링크.

## Cautions

- **CLAUDE.md의 다른 섹션을 손대지 말 것. 이유: surgical 변경 원칙 + 운영 SSOT.** 새 섹션 1개만 삽입.
- **런북에 "완전 자동 /clear"라고 쓰지 말 것. 이유: 사실과 다름.** 자동/수동 경계를 정확히 적는다.
