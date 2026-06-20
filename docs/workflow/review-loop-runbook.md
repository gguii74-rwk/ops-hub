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
