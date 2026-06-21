# 개발 사이클 런북: 적대검증 반복 + 컨텍스트 규율

설계: `docs/specs/2026-06-20-adversarial-review-loop-workflow-design.md`

## 한 phase의 end-to-end

각 단계는 **별도 세션**에서 시작한다(단계 경계 = 반드시 컨텍스트 초기화).

```
[spec]  superpowers:brainstorming → spec 작성·커밋
        → /review-loop --phase spec
        → (미판정 blocking 0) 핸드오프 작성 + "다음은 /clear 후 plan" 안내
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

- 매 반복 = **커밋 → 적대검증(커밋된 HEAD 기준) → 분류·판정(disposition) + ledger → ESCALATE 처리 → 종료판정 → FIXED 수정(impl=TDD / spec·plan=문서+정합성) → 재반복**.
- 종료: **미판정 blocking == 0**. 모든 critical/high/medium을 FIXED/ACCEPTED/DEFERRED_TO_IMPL/OUT_OF_SCOPE/DUPLICATE/ESCALATE로 닫는다. 목표는 "high 0"이 아니라 "판정 없이 남은 high 0".
- 판정 루프 전환: blocking score(critical=4·high=3·medium=1)가 2회 연속 안 줄면(정체/발산) 수정 루프를 멈추고 판정 루프로(더 고치지 말고 ledger에 닫음). 5회 초과 시 남은 미판정을 판정/ESCALATE로 닫고 사용자 대기.
- 분류·판정 기준은 `review-loop` 스킬과 plan §SC-2 참조.

### 실행 팁 (codex companion)
- 큰 변경(여러 파일·수천 줄)은 `adversarial-review --wait`를 **`run_in_background: true`**로 띄우고 완료 task-notification을 기다린다(폴링 금지).
- 결과 파일은 앞부분에 `[codex] …` 실행 로그가 섞여 있다 — 보고서만 추출: `sed -n '/^# Codex Adversarial Review/,$p' <outfile>`.
- 큰 plan은 매 회 ~2 high가 새 영역에서 나오는 경향(근본 결함 아님 — 적대검증이 `base..HEAD` 전체를 매번 다시 보기 때문). 그래서 "절대 개수 0"은 도달 불가능할 수 있다 → 목표를 "미판정 blocking 0"으로 두고, **blocking score 2회 연속 비감소면 판정 루프로 전환**해 남은 high를 ACCEPTED/DEFERRED_TO_IMPL/OUT_OF_SCOPE로 닫아 churn을 끊는다. 영역이 코어 정합성→주변부(UI·배포·타입)로 이동하면 spec/plan의 DEFERRED_TO_IMPL을 impl AC/테스트로 연결하고 impl 전환을 고려.

## 컨텍스트 규율(자동/수동 경계)

- **자동**: Stop 훅(`scripts/context-threshold-hook.mjs`)이 transcript 사용량을 계산해 40% 초과 시 "핸드오프 쓰고 /clear 안내"를 1회 넛지. review-loop도 같은 시점을 자체 점검.
- **수동(원리적 한계)**: 실제 `/clear` 입력은 사람이 한다. 자가 `/clear`·자동 단계전환은 Claude Code가 지원하지 않는다(설계 §2).
- 임계 조정: env `OPS_HUB_CTX_THRESHOLD`(0~1), 한도 override `OPS_HUB_CTX_LIMIT`.

## 왜 완전 무인이 아닌가
- 모델/훅은 자기 세션을 `/clear` 할 수 없다.
- 훅은 슬래시 커맨드/스킬을 호출하지 못한다(넛지만 가능).
- 그래서 "감지·반복·수정은 자동, /clear와 중요 의사결정은 사람"으로 설계했다.
