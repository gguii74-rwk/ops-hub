---
name: workflows-mail-recipients-spec
description: "메일 수신자 세트(sub-project B) spec 2R + plan 4R + SDD impl 10/10 + impl review-loop 3R 종결(미판정 0) → PR #31 생성(HEAD 2c4480f). 다음=머지 + kgs-dev 배포(preflight 필수)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0d6f5fa9-80f4-4413-a16d-4388985e9d6c
---

`feat/workflows-mail-recipients` 브랜치(main acd1d48에서 분기). sub-project **B(재사용 수신자 세트)**. spec = `docs/specs/2026-07-02-workflows-mail-recipients-design.md`(D1~D15 + §8 ledger), plan = `docs/plans/2026-07-02-workflows-mail-recipients.md` + task-01~10.

**사용자 기결정(재논의 말 것)**: ① 세트=타입×단계별 기본값(이름 있는 세트 없음) ② 관리=설정 카드+`/admin/settings/mail-recipients` 전용 페이지 ③ 쓰기 게이트=admin.settings:configure ∧ workflows.mail:configure(pm ALLOW) ④ 주소록=MailContact 테이블(email 유니크·불변 D15) ⑤ billing manageHref 수정 포함.

핵심 설계: cc/bcc 파이프라인(MailDelivery additive cc/bcc, recipients=to 보존) · `WorkflowType.defaultRecipients`=`{[step]:{to,cc,bcc}}` · task.recipients 체인 제거(컬럼 보존, D5 전제=배포 preflight로 DB 증명) · kind×step=SEND_STEP_TRANSITION 파생(BILLING 1·2) · effectiveRecipients 단계별 맵+주소록 enrich(:send 게이트) · bcc는 :send만 직렬화(D14) · 기록=전송 envelope(D10, normalizeEnvelope lib 소유).

**impl review-loop 3R 종결(2026-07-02, 미판정 blocking 0)** — score 0→1→0:
- **FIXED 2**: ① [06-E1] contact PATCH memo 생략=보존·공백=클리어 분리(`1041fc2`, 사용자 판정) ② 그 파생 회귀 — 수정 모달이 memo 항상 전송해 클리어 가능(`2c4480f`)
- **DUPLICATE(기판정 재지목)**: 세트 LWW=plan ACCEPTED(통산 6회 재지목) · AuditLog=plan OUT_OF_SCOPE(follow-up) · **legacy recipients 실행형 가드=spec D5·§7 기결정**(배포 preflight SQL로 non-null 0 증명·fail-fast, in-repo 가드 미채택 — R2·R3 연속 재지목, 재논의 말 것)
- 게이트: typecheck/lint 0 · test **1790** · build green · no-AI-trace(메타 커밋 메시지 재작성 `d74397d`)

**PR #31 생성 완료**(push됨, origin=로컬 `2c4480f`). **다음=머지(merge commit, 머지 전 origin==로컬 확인) + kgs-dev 배포**: preflight(§7 — `workflows."WorkflowTask"."recipients"`·`workflows."WorkflowType"."defaultRecipients"` non-null 0, multiSchema 스키마 한정) → additive 2건 migrate → prisma:generate → db:seed(workflows.mail:configure+pm reconcile) → 표준 restart → smoke. 관련: [[workflows-calendar-spec]] [[workflows-billing-ui-review-loop]] [[session-per-merge-workflow]] [[no-ai-trace-in-review-loop-output]]
