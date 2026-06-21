# 적대검증 반복 루프 + 컨텍스트 규율 워크플로우 설계

- 날짜: 2026-06-20
- 상태: 설계(브레인스토밍 합의 완료)
- 범위: 개발 워크플로우 자동화 도구 (애플리케이션 도메인 코드 아님)

## 1. 배경·목표

spec/plan 문서 생성 또는 구현 작업(예: `superpowers:subagent-driven-development`)이 끝났을 때,
변경사항을 커밋하고 `/codex:adversarial-review`로 적대 검증을 돌린 뒤,
리뷰 결과를 **보수적으로 수용/비수용 판단**하고,
**모든 critical/high/medium finding을 FIXED/ACCEPTED/DEFERRED_TO_IMPL/OUT_OF_SCOPE/DUPLICATE/ESCALATE 중 하나로 판정해, 미판정(unadjudicated) blocking이 0이 될 때까지 반복**하는 흐름을 도구화한다.
**blocking score가 2회 연속 줄지 않으면(정체/발산) 수정 루프를 멈추고 판정 루프로 전환한다. 목표는 "high 0"이 아니라 "판정 없이 남은 high 0"이다.**
반복 중 컨텍스트 사용량이 임계(40%)를 넘으면 상태를 핸드오프로 저장하고 `/clear` 후 이어가도록 유도한다.

목표는 "최대한 자동화하되, **원리적으로 불가능한 부분은 정직하게 수동으로 남기고 그 경계를 명확히 문서화**"하는 것이다.

## 2. Claude Code 능력 제약 (재논의 방지용 기록)

설계 전 `claude-code-guide` 확인 + 로컬 codex 플러그인 점검으로 확정한 사실:

1. **자가 `/clear` 불가.** 모델도, 어떤 훅도 자기 세션을 `/clear` 할 수 없다. → 컨텍스트 초기화의 마지막 한 스텝(`/clear` 입력)은 **반드시 사람**이 한다.
2. **컨텍스트 사용률은 statusLine만 직접 받는다**(`context_window.used_percentage`). 단 글로벌 statusLine은 이미 `claude-hud`가 점유 + 글로벌 `~/.claude`는 git 비동기(수동 유지) 영역이라 끼워넣지 않는다. → 대안으로 **Stop 훅이 `transcript_path`의 마지막 assistant `usage`를 읽어 사용량을 직접 계산**한다.
3. **`/codex:adversarial-review`는 커맨드이며 `disable-model-invocation: true`**라 모델이 슬래시 커맨드로 호출할 수 없다. 단 내부적으로 `node ${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs adversarial-review …`를 실행할 뿐이라, 스킬이 **동일 스크립트를 Bash로 직접 호출**하면 루프 자동화가 가능하다.
4. **훅은 슬래시 커맨드/스킬을 호출하지 못한다.** 훅이 할 수 있는 것은 차단(exit 2 / `decision:block`)과 컨텍스트 주입(`additionalContext`/`reason`)뿐이다. → 단계 완료 시 "리뷰 루프 실행"은 **하드 트리거가 아니라 넛지**다.
5. **하드 강제(always-run) 메커니즘은 없다.** 가장 가까운 자동은 codex의 `stop-review-gate`(직전 턴 코드 변경에 대한 ALLOW/BLOCK 단일 게이트)지만 반복 루프는 아니다.

### 정직한 자동/수동 경계

| 구분 | 항목 |
|---|---|
| **진짜 자동** | 적대검증 실행·JSON 파싱·보수적 분류·자동 수정·게이트·재커밋·재검증·반복·종료 판정 / 컨텍스트 40% 감지 및 1회 넛지 |
| **반드시 수동(원리적 한계)** | 실제 `/clear` 입력 / 에스컬레이션된 "중요 의사결정"에 대한 사용자 답변 |

## 3. 범위

### 포함 (옵션 1: 집중 스킬 + 런북)

1. `review-loop` 스킬 — "커밋→적대검증→분류→수정→반복" 한 가지를 잘 수행하는 집중 스킬.
2. 컨텍스트 임계 Stop 훅 — `transcript usage` 기반 40% 감지 + 핸드오프/`/clear` 1회 넛지. 프로젝트 `settings.json` + `scripts/` 스크립트로 **git 동기화(양 노트북 동일)**.
3. 런북 문서 — brainstorming → writing-plans-split → subagent-driven-development 사이에 이 루프와 `/clear` 지점을 어떻게 끼우는지.

### 제외 (비목표)

- spec→plan, plan→impl 전체를 한 스킬이 순차 구동하는 풀 오케스트레이터(`dev-cycle`) — 2차 과제로 보류(메가스킬은 깨지기 쉽고 기존 superpowers 스킬을 감싸야 함).
- 기존 superpowers 스킬(brainstorming/writing-plans-split/subagent-driven-development) 수정 — 플러그인 캐시 영역이고 cross-machine 비동기라 건드리지 않는다.
- statusLine 기반 40% 감지 — 위 제약 2번 사유로 폐기.
- 자동 `/clear` — 원리적 불가.

## 4. 구성요소

### 4.1 `review-loop` 스킬

- 위치: `.claude/skills/review-loop/SKILL.md` (git 추적, 양 노트북 공유)
- 호출: 사용자가 단계 완료 후 직접 호출(예: `/review-loop`), 또는 Stop 훅 넛지가 호출을 유도.
- 인자(선택): `--phase spec|plan|impl`(기본 auto 추론), `--max <n>`(기본 5), `--base <ref>`(브랜치 리뷰 기준, 기본 `main`), `--auto-rounds <n>`(기본 3, 초반 자동 모드 라운드 수; 0=매회 즉시).

#### 알고리즘

```
review-loop [--phase ...] [--max 5] [--base main]

0) resume 점검: .remember/ 핸드오프에 미완 루프 상태가 있으면 iteration·미해결 finding 복원.

1) 사전 게이트(impl 단계):
   npm run typecheck && npm run lint && npm test && npm run build
   - 실패하면 루프 시작 전에 먼저 처리(또는 사용자 보고). 깨진 상태로 리뷰 시작 금지.

2) 반복 (iteration = resume값..max):
   a. [커밋 우선] 작업 트리에 미커밋 변경이 있으면 의미 있는 메시지로 커밋.
      ── 핵심: 적대검증은 커밋된 HEAD(브랜치 diff) 기준으로 봐야 직전 수정이 반영된다.
         미커밋 상태로 리뷰하면 변경을 놓친다. 그래서 "수정→커밋→리뷰" 순서를 강제한다.
   b. 적대검증 실행:
      node "${CODEX_PLUGIN_ROOT}/scripts/codex-companion.mjs" adversarial-review --wait --base <ref>
      - 변경 규모가 크면(파일 다수/디렉터리 단위) background로 띄우고 폴링.
      - 출력 = review-output.schema.json 구조(JSON): { verdict, summary, findings[], next_steps }.
   c. 분류·판정(disposition) + ledger 대조:
      각 critical/high/medium finding을 fingerprint(file+정규화 title+recommendation, severity 제외)로 ledger와 대조하고
      disposition을 부여한다:
        · FIXED            : 수정 방향이 명확(버그·누락 가드·테스트 공백·경쟁조건·권한 검사 등) → 수정 큐.
        · ACCEPTED         : 실제 위험이나 현 단계에서 의도적 수용(이유+보완 명시).
        · DEFERRED_TO_IMPL : spec/plan에서 못 닫음 → impl plan의 AC/테스트로 이전·연결.
        · OUT_OF_SCOPE     : 이번 변경 범위 밖(follow-up 기록).
        · DUPLICATE        : 기존 ledger 항목과 동일.
        · ESCALATE         : 사용자 결정 필요 — (a) 제품 범위/동작 변경, (b) spec 의도 반함, (c) 설계 선택지 2+, (d) 보안·데이터 트레이드오프, (e) confidence 낮음.
      low → DEFER_LOW(요약에만). 미판정 blocking score(critical=4·high=3·medium=1) 기록.
   d. ESCALATE 처리(모드 분기): 자동 모드(iteration ≤ auto-rounds, 기본 3)에서는 즉시군(critical·보안/데이터·방향전제)만 AskUserQuestion, batch군은 ledger에 적재(안 물음). batch 전환 시점(auto-rounds 도달·score 정체·FIXED 소진)/정밀 모드(>auto-rounds)에서 모아둔 batch ESCALATE + round별 자동수정 내역을 일괄 제시 → FIXED/ACCEPTED/DEFERRED_TO_IMPL/OUT_OF_SCOPE로 닫거나 "중단"(핸드오프 쓰고 종료).
   e. 종료 판정:
      미판정 blocking == 0 AND FIXED 큐 == 0  →  성공 종료(요약 보고) → 4)로.
      (미판정 blocking = critical/high/medium 중 disposition 없는 것 + FIXED 재확인 대기. low·판정완료 제외)
      신규 blocking이 없고 ledger가 모두 닫혀 있으면 즉시 종료(빠른 경로).
   f. FIXED 큐 처리(phase 분기):
        · impl: TDD(실패 테스트 → 수정 → 게이트 통과). 가능하면 subagent-driven-development.
        · spec/plan: 문서 수정 후 phase 관문 재확인 + 문서 내부 정합성(결정/가정/AC 상호모순) 자체 점검. DEFERRED_TO_IMPL은 impl plan AC/테스트에 기재.
   g. 게이트 재실행 통과 확인(spec/plan은 관문 재확인으로 갈음).
   h. 판정 루프 전환/한도: blocking score가 2회 연속 비감소(s_n ≥ s_{n-1} ≥ s_{n-2})면 수정 루프를 멈추고 판정 루프로 전환(남은 미판정을 ACCEPTED/DEFERRED_TO_IMPL/OUT_OF_SCOPE/ESCALATE로 닫음).
      iteration > max(5)면 멈추되, 멈추기 전 남은 미판정을 가능한 한 판정으로 닫고 못 닫는 것만 ESCALATE로 사용자에게(미판정 방치 금지).
   i. 컨텍스트 점검: 사용률 ≥ 40%면 핸드오프(아래 4.3) 작성 + 사용자에게 /clear 안내.
      → 새 세션에서 review-loop 재호출 시 0) resume로 이어감.
      (Stop 훅이 이 시점을 별도 넛지로도 잡아줌 — 이중 안전망)
   j. iteration++ ; 2)로.

3) (각 반복 끝의 커밋은 a 단계가 다음 반복 시작 때 수행한다.)

4) 종료 요약: 총 반복 횟수, 자동수정 내역, ESCALATE 처리 내역, 남은 medium/low, 최종 verdict.
```

- **종료 심각도**: 미판정 blocking == 0이어야 종료(모든 critical/high/medium이 FIXED 또는 ACCEPTED/DEFERRED_TO_IMPL/OUT_OF_SCOPE/DUPLICATE/ESCALATE로 판정됨). 목표는 "high 0"이 아니라 "판정 없이 남은 high 0". low·판정완료 항목만 남는다.
- **판정 루프 전환**: blocking score(critical=4·high=3·medium=1)가 2회 연속 감소하지 않으면(정체/발산) 수정 루프를 멈추고 판정 루프로 전환한다(더 고치지 말고 ledger에 닫음). count가 아닌 score로 봐야 high→medium 같은 심각도 개선을 정체로 오판하지 않는다.
- **리뷰 스코프**: 기본 `--base main` 브랜치 리뷰(커밋된 HEAD 기준). spec/plan 문서 단계도 동일하게 "커밋 후 리뷰".
- **resume 계약**: 중단/`/clear` 시 `.remember/` 핸드오프에 `{ phase, iteration, base, ledger: [{fingerprint, severity, disposition(FIXED|ACCEPTED|DEFERRED_TO_IMPL|OUT_OF_SCOPE|DUPLICATE|ESCALATE|DEFER_LOW), 근거}], score 이력 }`를 적어 새 세션이 이어받는다.

### 4.2 컨텍스트 임계 Stop 훅

- 스크립트: `scripts/context-threshold-hook.mjs` (node, git 추적)
- 설정: 프로젝트 `.claude/settings.json`의 `hooks.Stop`에 등록(글로벌 Stop 훅과 **병합** 실행, 충돌 없음).
- 입력(stdin JSON): `{ transcript_path, session_id, stop_hook_active, ... }`
- 동작:
  1. `stop_hook_active === true`면 즉시 exit 0 (무한 루프 방지).
  2. 이미 이 세션에 넛지했으면(플래그 파일 존재) exit 0 (매 턴 반복 방지).
  3. `transcript_path`(JSONL)에서 **마지막 assistant 메시지의 `message.usage`**를 읽어
     `used = input_tokens + cache_read_input_tokens + cache_creation_input_tokens` 계산.
  4. 한도 결정: 마지막 assistant `message.model`에 `[1m]` 포함 → `1_000_000`, 아니면 `200_000`.
     (env `OPS_HUB_CTX_LIMIT`로 override 가능)
  5. `used / limit ≥ THRESHOLD`(기본 0.40, env `OPS_HUB_CTX_THRESHOLD`)면:
     - 넛지 플래그 파일 생성(scratchpad).
     - `{"decision":"block","reason":"<핸드오프 작성 + 사용자에게 /clear 요청 지시>"}` 출력.
       → Claude가 멈추지 않고 reason을 처리(핸드오프 쓰고 사용자에게 /clear 안내) 후 다시 stop 시도,
         이때 플래그가 있어 exit 0 → 정상 종료.
  6. 임계 미만이면 exit 0.
- 임계값·한도는 스크립트 상단 상수 + env override로 조정 가능.

### 4.3 단계 경계 규율 + 런북

- 단계 경계(spec→plan, plan→impl)에서는 **반드시 컨텍스트 초기화**:
  - 직전 단계 종료 시 `review-loop`가 통과(미판정 blocking 0; ledger의 ACCEPTED/DEFERRED_TO_IMPL/OUT_OF_SCOPE를 산출물 문서에 명시)하면, 스킬이 `.remember/` 핸드오프를 쓰고
    "다음 단계는 `/clear` 후 시작하세요" + 다음 단계 진입 커맨드를 안내.
- 런북 문서(`docs/`): 한 phase의 end-to-end 순서를 적는다.
  ```
  [spec] superpowers:brainstorming → spec 작성·커밋 → /review-loop --phase spec
         → (통과) 핸드오프 + 안내 → 사용자 /clear
  [plan] (새 세션) writing-plans-split → plan 작성·커밋 → /review-loop --phase plan
         → (통과) 핸드오프 + 안내 → 사용자 /clear
  [impl] (새 세션) subagent-driven-development → 구현·커밋 → /review-loop --phase impl
         → (통과) finishing-a-development-branch
  ```

## 5. 인터페이스·계약

### 5.1 adversarial-review companion

- 호출: `node "<codex plugin root>/scripts/codex-companion.mjs" adversarial-review --wait --base <ref>`
  - 플러그인 루트는 설치 경로에서 탐지(예: `~/.claude/plugins/cache/openai-codex/codex/<ver>/`). 버전 하드코딩 금지 — 최신 디렉터리 탐지.
- 출력 스키마(`schemas/review-output.schema.json`):
  ```
  verdict: "approve" | "needs-attention"
  summary: string
  findings[]: { severity: "critical"|"high"|"medium"|"low", title, body,
                file, line_start, line_end, confidence(0..1), recommendation }
  next_steps[]: string
  ```
- 종료 판정 입력 = 미판정 blocking finding 개수(critical/high/medium 중 disposition 없는 것 + FIXED 재확인 대기; low·판정완료 제외).

### 5.2 핸드오프(`.remember/remember.md`)

- 기존 remember 포맷 활용. 루프 재개에 필요한 최소 상태를 명시 섹션으로 추가:
  `phase / iteration / base / ledger(file·severity·disposition(FIXED|ACCEPTED|DEFERRED_TO_IMPL|OUT_OF_SCOPE|DUPLICATE|ESCALATE|DEFER_LOW)·fingerprint·근거) / blocking score 이력`.

### 5.3 Stop 훅 입출력

- 입력: Claude Code Stop 훅 표준 stdin JSON.
- 출력: 임계 초과 시 `{"decision":"block","reason":"..."}`, 그 외 exit 0.

## 6. 데이터 흐름 (impl 한 phase)

```
구현 완료(subagent-dev)
  → /review-loop --phase impl --base main
      ├─ 게이트 통과 확인
      └─ 반복:
           커밋 → companion adversarial-review --wait --base main → JSON
           ├─ 분류·판정(disposition) + ledger/score 갱신 → (ESCALATE? AskUserQuestion)
           ├─ 미판정 blocking == 0 & FIXED 큐 0 → 종료 요약
           └─ FIXED 수정(impl=TDD / spec·plan=문서+정합성) → 게이트
                   → (score 2회 비감소? 판정 루프 전환) → (≥40%? 핸드오프+/clear) → 다음 반복(커밋 후 리뷰)
  → 통과 시 finishing-a-development-branch
세션 도중 ≥40% 도달 시 Stop 훅이 핸드오프+/clear를 별도로 넛지(이중 안전망)
```

## 7. 에러 처리·부분 실패

- **codex 미설치/미인증**: companion 실패 시 루프 중단하고 `/codex:setup` 안내(자동 수정 시도 금지).
- **리뷰 background 미완**: `--wait` 기본, 큰 변경만 background+폴링. 폴링 타임아웃 시 사용자에게 상태 보고.
- **게이트 실패**: 수정 후 게이트가 깨지면 그 반복은 커밋하지 않고 원인부터 해결(systematic-debugging). 깨진 채 다음 리뷰로 넘어가지 않음.
- **JSON 파싱 실패**: 출력이 스키마와 다르면 루프 중단·원문 보고(추측 금지).
- **무한 반복 방지**: blocking score 2회 연속 비감소면 판정 루프로 전환(수정 중단). `--max`(기본 5) 초과 시 멈추되 남은 미판정은 판정/ESCALATE로 닫고 사용자 대기.

## 8. 테스트 전략

- `scripts/context-threshold-hook.mjs`: 단위 테스트 — 합성 transcript JSONL fixture로
  (임계 미만/초과, `[1m]` vs 200k 한도, `stop_hook_active` 가드, 플래그 중복 방지) 검증.
- `review-loop` 스킬: 문서(절차)라 자동 테스트 대상 아님 → 드라이런으로 1회 수동 검증
  (작은 의도적 finding을 심어 루프가 잡고 커밋-후-리뷰 순서를 지키는지 확인).
- 회귀: 훅 스크립트 테스트는 기존 vitest 스위트에 포함하되, codex/네트워크에 의존하지 않게 격리.

## 9. 보안·운영 고려

- **AI 서명 금지**: 모든 커밋 메시지에 `Co-Authored-By: Claude` 등 금지(글로벌 규칙).
- **cross-machine 일관성**: 스킬·훅·스크립트·문서는 모두 git 추적(`.claude/`, `scripts/`, `docs/`). 글로벌 `~/.claude`·statusLine·claude-hud는 건드리지 않음.
- **글로벌 훅 보존**: 프로젝트 Stop 훅은 글로벌(Stop/Notification)과 병합 실행 — 기존 훅 보존.
- **민감정보**: 핸드오프/넛지에 비밀·자격증명 기록 금지.

## 10. 미해결·향후

- (2차) 풀 오케스트레이터 `dev-cycle` 스킬: 단계 전체 순차 구동 — 본 집중 스킬이 안정화된 뒤 검토.
- (2차) Stop 훅에서 단계 산출물(spec/plan 생성) 감지 → "review-loop 실행" 넛지 추가(현재는 사용자 호출 + 컨텍스트 넛지만).
- 토큰 한도 자동 판별 정확도(모델 id 외 신호) 개선 여지.
