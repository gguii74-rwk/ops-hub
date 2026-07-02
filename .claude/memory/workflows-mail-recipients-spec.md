---
name: workflows-mail-recipients-spec
description: "메일 수신자 세트(sub-project B) spec 2R + plan 4R + SDD impl 10/10 완료(HEAD 8fb7ba2, opus 최종리뷰 merge-ready, push 필요). 다음=새 세션 review-loop(phase=impl) → PR"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0d6f5fa9-80f4-4413-a16d-4388985e9d6c
---

`feat/workflows-mail-recipients` 브랜치(main acd1d48에서 분기). sub-project **B(재사용 수신자 세트)** = 사용자 4요청 중 4번. spec = `docs/specs/2026-07-02-workflows-mail-recipients-design.md`(D1~D15 + §8 ledger). **plan = `docs/plans/2026-07-02-workflows-mail-recipients.md`(§SC-1~11) + task-01~10 분할**(writing-plans-split, 2026-07-02, HEAD `4fcf666` — **push 필요**).

**사용자 기결정(재논의 말 것)**: ① 세트 개념=타입×단계별 기본값(day-sync 방식, 이름 있는 세트 선택 없음) ② 관리 UI=설정 페이지 카드+`/admin/settings/mail-recipients` 전용 페이지 ③ 쓰기 게이트=admin.settings:configure ∧ **workflows.mail:configure 신설**(pm ALLOW) ④ 주소록=**MailContact 테이블**(email 유니크·이름·메모 중앙 관리) ⑤ billing manageHref 깨진 링크(`/admin/settings/billing`→`/workflows/billing/settings`) 수정 포함.

핵심 설계: cc/bcc 파이프라인(MailMessage optional 확장, MailDelivery **additive cc/bcc 컬럼**, recipients=to 의미 보존) · `WorkflowType.defaultRecipients` 구조화 `{[step]:{to,cc,bcc}}`(현재 전부 null=마이그레이션 불필요, preflight로 증명) · task.recipients 체인 제거(컬럼 보존) · kind×step=`SEND_STEP_TRANSITION` 파생 단일 출처(BILLING 1·2) · effectiveRecipients=단계별 맵+주소록 이름 enrich(:send 게이트) · **bcc는 :send만 직렬화**(D14) · **기록=전송 envelope**(D10, normalizeEnvelope lib 소유) · **MailContact.email 불변**(D15) · 死설정 weeklyReport.defaultRecipients catalog 제거.

**plan 적대검증 4R 종결**(score 3→3→1→0, 미판정 0): FIXED 3 — ① PUT 부분 body의 타 단계 세트 삭제→**step 집합 정확 일치 400** ② runSend `recipients: []` defaults 폴백→**존재(≠undefined) 기준·[] 거부** ③ 관리 서비스 무권한 계약→**전 함수 userId+requireManageMailRecipients 내부 강제**(라우트는 401+mapError). **ACCEPTED(재논의 말 것)**: 세트 저장 LWW(낙관락 없음 — D6 명시 envelope·편집주체 소수·billing config 선례, codex 4회 재지목=DUPLICATE). **OUT_OF_SCOPE(follow-up)**: 주소록·세트 변경 AuditLog(relational 관리 경로 공통 과제).

**impl SDD 완료(2026-07-02)**: 10/10 task + fix 1, 커밋 11개(`a0beba5`…`8fb7ba2`, base 4fcf666 — **origin 미push**). task 리뷰 전부 Approved(sonnet, task-10 재리뷰 1회 — draft 저장 후 서버 정규화 echo 동기화 fix `8fb7ba2`). **최종 opus whole-branch 리뷰 merge-ready(Critical/Important 0)** — 10대 불변식 end-to-end 검증. 게이트: typecheck/lint 0·test 1787(1 사전존재 env 실패 무관)·build green·no-AI-trace clean. 원장 = `.superpowers/sdd/progress.md`.

**미결 1건(사람 판정, 비차단)**: [06-E1] editMailContact PATCH가 memo 생략 시 기존 memo를 null로 교체(brief verbatim = "편집 필드 전체 교체" 계약; 모달은 memo 왕복이라 제품 플로우 무손실, 직접 API만 해당). 선택지: 현행 유지+계약 명문화 vs `memo !== undefined` 조건부 갱신. review-loop 세션에서 판정 권장.

**다음=새 세션 `dev-workflow:review-loop --phase impl`**(codex 재지목 시 기판정 처리: LWW=ACCEPTED·감사로그=OUT_OF_SCOPE·[06-E1]=판정 대기) → push + PR. 배포=additive 2건 표준 restart+preflight(task-05 §배포 — legacy 값 0 증명 fail-fast). 관련: [[workflows-calendar-spec]] [[workflows-billing-ui-review-loop]] [[session-per-merge-workflow]] [[no-ai-trace-in-review-loop-output]] [[settings-redesign-spec]]
