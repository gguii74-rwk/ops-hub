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

[impl]  (새 세션) superpowers:subagent-driven-development → 구현(내장 task 리뷰 포함)·커밋
        → /review-loop --phase impl (최종 통합 --base main; 보안 묶음은 경계마다)
        → (통과) superpowers:finishing-a-development-branch
```

## review-loop 한눈에

- 매 반복 = **커밋 → 적대검증(커밋된 HEAD 기준) → 분류·판정(disposition) + ledger → ESCALATE 처리 → 종료판정 → FIXED 수정(impl=TDD / spec·plan=문서+정합성) → 재반복**.
- 종료: **미판정 blocking == 0**. 모든 critical/high/medium을 FIXED/ACCEPTED/DEFERRED_TO_IMPL/OUT_OF_SCOPE/DUPLICATE/ESCALATE로 닫는다. 목표는 "high 0"이 아니라 "판정 없이 남은 high 0".
- 판정 루프 전환: blocking score(critical=4·high=3·medium=1)가 2회 연속 안 줄면(정체/발산) 수정 루프를 멈추고 판정 루프로(더 고치지 말고 ledger에 닫음). 5회 초과 시 남은 미판정을 판정/ESCALATE로 닫고 사용자 대기.
- 자동 모드(`--auto-rounds`, 기본 3): 초반 n회는 FIXED 자동수정 + 위험군(critical·보안·방향전제) 외 ESCALATE를 batch로 모아 일괄 제시(사람 개입 최소화). score 정체 시 조기 batch 전환, 이후 정밀 모드. 상세: 스킬.
- 분류·판정 기준은 `review-loop` 스킬과 plan §SC-2 참조.

### 실행 팁 (codex companion)
- 큰 변경(여러 파일·수천 줄)은 `adversarial-review --wait`를 **`run_in_background: true`**로 띄우고 완료 task-notification을 기다린다(폴링 금지).
- 결과 파일은 앞부분에 `[codex] …` 실행 로그가 섞여 있다 — 보고서만 추출: `sed -n '/^# Codex Adversarial Review/,$p' <outfile>`.
- 큰 plan은 매 회 ~2 high가 새 영역에서 나오는 경향(근본 결함 아님 — 적대검증이 `base..HEAD` 전체를 매번 다시 보기 때문). 그래서 "절대 개수 0"은 도달 불가능할 수 있다 → 목표를 "미판정 blocking 0"으로 두고, **blocking score 2회 연속 비감소면 판정 루프로 전환**해 남은 high를 ACCEPTED/DEFERRED_TO_IMPL/OUT_OF_SCOPE로 닫아 churn을 끊는다. 영역이 코어 정합성→주변부(UI·배포·타입)로 이동하면 spec/plan의 DEFERRED_TO_IMPL을 impl AC/테스트로 연결하고 impl 전환을 고려.

### 리뷰 입도 — phase별

리뷰를 통째로 돌릴지 쪼갤지는 **단계마다 다르다**(결함 성격이 다르므로).

| 단계 | 분량 | 결함 성격 | 입도 |
|---|---|---|---|
| spec | 1문서 | 방향·정합성 | **단일**(통째 1회) |
| plan | entrypoint+task 수~십몇개 | **문서 간 모순**(shared contract) | **통합**(통째 1회, `--base main`) |
| impl | task 여러개 | 코드 국소 결함 | **per-task 증분 + 마지막 통합** |

- **plan을 task별로 쪼개 리뷰하지 말 것** — plan의 가치는 "task-03이 task-05 인터페이스와 맞는가" 같은 전체 정합성이라 통째로 봐야 잡힌다.
- auto-rounds 효과도 단계마다 다르다: impl은 FIXED가 많아 자동화 이득이 크고, spec은 ESCALATE가 대부분 방향결정=위험군이라 어차피 즉시 떠 이득이 작다.

#### impl 세부 (per-task vs end-to-end)

impl phase에서 리뷰를 **각 task마다** 돌릴지 **전부 끝나고 한 번** 돌릴지는 plan 구조로 정한다. **spec/plan 단계엔 적용하지 않는다**(문서는 항상 전체 diff 리뷰). 이는 강제 규칙이 아니라 선택 가이드다 — review-loop 스킬의 `--base` 기본값(`main`)·절차는 그대로다.

- **per-task(묶음) 리뷰 + 마지막 통합 리뷰** — task가 많고(대략 5+) **계층형·강결합·보안크리티컬**일 때. 각 task(또는 강결합 묶음) 커밋 직후 `--base <그 task 시작 직전 HEAD>`로 그 task diff만 리뷰 → 결함을 만든 직후·전파 전에 닫는다. 결합도로 묶는다(예: 가드 단독 / repo+service 묶음 / 라우트·세션 각각 단독).
- **end-to-end 1회** — task가 적거나(2~3) 독립적·약결합일 때. `--base main`으로 전체를 한 번. 이런 경우 per-task는 오버헤드다.

**증분 base 안전조건(필수).** `--base <직전 task>`는 그 task diff만 보므로 **이전 task를 깨는 회귀를 못 본다.** 그래서 per-task 증분 리뷰를 쓸 땐 **반드시 마지막에 통합 리뷰 1회(`--base main`)** 로 회귀 + 교차-task 결함(인터페이스 불일치·교차 모듈 경쟁조건·전체 흐름)을 잡는다. 통합 리뷰 없이 증분만 쓰지 말 것. (review-loop가 증분 검증을 기본 채택하지 않는 이유 = 이 회귀 누락 위험. 통합 리뷰와 짝일 때만 안전하다.)

**판정(ledger) 연계.** per-task 리뷰에서 "상부 task가 와야 검증되는" finding은 `DEFERRED_TO_IMPL`로 ledger에 남기고, 마지막 통합 리뷰에서 그 항목들을 재확인해 닫는다.

**base 잡는 법.** 각 task 시작 시 `git rev-parse HEAD`로 현재 HEAD를 기록해 그 task의 base로 쓴다. 이러면 무관한 커밋(워크플로 문서 등)이 사이에 끼어도 자동 제외된다.

## SDD ↔ codex 통합 (impl 실행)

`superpowers:subagent-driven-development`(SDD)는 **이미 task별 리뷰+수정 루프를 내장**한다(implementer → task-reviewer[spec+품질] → fix → re-review → ledger → 다음 task, 끝에 whole-branch review). 그래서 "task마다 리뷰"는 SDD가 자동으로 한다.

SDD 내장 리뷰와 codex review-loop는 **중복이 아니라 보완**이다:
- **SDD task-reviewer(claude)** = 건설적 — "spec대로 만들었나, 깔끔한가".
- **codex review-loop** = 적대적 — "어떻게 깨지나, 보안·경쟁조건·데이터손상"(외부 시각).

따라서 **codex를 task마다 끼우지 않는다**(과중·중복). 전략 지점에만:
- **일반 작업**: SDD를 끝까지(내장 리뷰가 task별 품질 보증) → 최종 whole-branch를 codex로 대체. `/review-loop --phase impl --base main --auto-rounds 3`.
- **보안 도메인**: 보안 크리티컬 묶음만 SDD를 끊고 경계에서 codex 추가(예: 가드·세션 묶음 후 1회). SDD에 범위를 지정해 호출(`task 1~6만 실행`).

**충돌 주의(순서).** SDD는 fix를 subagent에 위임하고 codex review-loop의 FIXED도 코드를 고친다. 같은 task를 둘이 동시에 건드리면 꼬인다 → **SDD가 task를 approved로 끝내 커밋한 뒤, 그 위에서 codex를 돌린다.** codex는 SDD 승인 코드를 적대 검증하는 2차 방어선이지 동시 수정자가 아니다.

**ledger 두 개.** SDD 진행 ledger(`.superpowers/sdd/progress.md`)와 review-loop 핸드오프 ledger(`.remember/`)는 별개다. 단계 경계 핸드오프에서 둘 다 참조한다.

## 컨텍스트 규율(자동/수동 경계)

- **자동**: Stop 훅(`scripts/context-threshold-hook.mjs`)이 transcript 사용량을 계산해 40% 초과 시 "핸드오프 쓰고 /clear 안내"를 1회 넛지. review-loop도 같은 시점을 자체 점검.
- **수동(원리적 한계)**: 실제 `/clear` 입력은 사람이 한다. 자가 `/clear`·자동 단계전환은 Claude Code가 지원하지 않는다(설계 §2).
- 임계 조정: env `OPS_HUB_CTX_THRESHOLD`(0~1), 한도 override `OPS_HUB_CTX_LIMIT`.
- **능동적 /clear 권장**: 40%를 기다리기보다 **task/단계 경계라는 깨끗한 절단면**에서 끊는 게 핸드오프 품질이 좋다(40% 훅은 안전망). impl은 task 2~3개를 한 세션으로 묶고 그 끝에서 핸드오프+/clear.

### 핸드오프 표준 섹션

핸드오프 품질 = 자동화 성패다(새 세션이 산문을 재해석하느라 사람에게 되묻으면 개입이 는다). `.remember/remember.md`에 **4개 고정 섹션**으로 쓴다:

    ## 핸드오프 (review-loop)
    - 현재: phase=plan, 다음=impl
    - task 진행: [x]01 [x]02 [ ]03..09   (plan task table 미러)
    - 미해결 ledger: DEFERRED_TO_IMPL 3건(→ impl task-04/07 AC에 연결), ACCEPTED 1건(이유·보완)
    - 다음 액션: /clear 후 새 세션에서 <다음 진입 커맨드>

새 세션이 이것만 읽고 사람 질문 없이 이어간다. 단계 경계의 DEFERRED_TO_IMPL이 다음 단계 산출물(AC/테스트)로 연결됐는지도 여기서 확인한다.

## 왜 완전 무인이 아닌가
- 모델/훅은 자기 세션을 `/clear` 할 수 없다.
- 훅은 슬래시 커맨드/스킬을 호출하지 못한다(넛지만 가능).
- 그래서 "감지·반복·수정은 자동, /clear와 중요 의사결정은 사람"으로 설계했다.
