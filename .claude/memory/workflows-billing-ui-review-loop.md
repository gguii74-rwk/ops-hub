---
name: workflows-billing-ui-review-loop
description: "대금청구(billing) 1·2단계 UI impl review-loop 5회 종결 — 5 FIXED·1 ACCEPTED·3 OUT_OF_SCOPE, 사용자 판정 결정과 follow-up"
metadata: 
  node_type: memory
  type: project
  originSessionId: 72f36753-59c0-497d-9fdc-4343af784e51
---

`feat/workflows-billing-ui` impl 단계 review-loop(codex 적대검증) **5회(=max) 종결, 미판정 blocking 0** → **PR #29 머지 완료**(merge commit **98c1d9a**, 2026-07-01, feature HEAD 5d1863c). base=e1ff518(plan HEAD). 머지 전 게이트 이 노트북에서 재검증 green(typecheck·lint·**test 1634**·build), mergeable=clean, origin=로컬 일치 확인. no-AI-trace 확인. [[session-per-merge-workflow]] [[no-ai-trace-in-review-loop-output]]

**FIXED (5):**
- **F1**(c2b66fb) 다운로드 서버측 status 게이트 — `download.ts`가 view 권한만 보고 status 미검사 → CANCELLED 파일 직접 API 다운로드 가능. **사용자 승인**으로 D1 백엔드 2→3건 확장. repo select에 status 추가 + `isDownloadableStatus` 게이트(404).
- **F3**(eaf5f00) send-modal 사업명 stale prefill — `<SendForm key={projectName}>` remount로 config refetch 시 재prefill.
- **N2**(3a25568) FINAL_SENT 서버 허용/UI 숨김 분기 — `policy.isDownloadableStatus`(client-safe) 단일 출처로 서버·UI 공유. (F1이 서버집합 넓혀 표면화)
- **N4-UI**(fcdb082) 설정 RoundsTable이 config 없는 새 연도에 렌더 → orphan 회차일 — `selectedConfig != null` 게이트.
- **N6**(5d1863c) 기존 DB pm에 `workflows.billing:create` 누락(fresh는 pm `*`, 기존은 billing-upgrade가 create 빼고 reconcile, flag 이미 set). **사용자 승인**으로 별도 멱등 flag 헬퍼 `billing-create-upgrade.ts` 추가, seed 3e 단계 연결.

**사용자 판정 결정 (재논의 말 것):**
- **N3 (high) = ACCEPTED**: 메일 prefill이 생성시점 아닌 현재 config 사용 → 생성 후 config 편집/삭제 시 메일↔첨부문서 사업명 drift 가능. **spec D5+D6**(현재 config GET 재사용·"백엔드 추가 0"·편집형 모달=마지막 신뢰경계)로 현행 유지. 보완 follow-up=생성시점 config 스냅샷(상시 편집 운영 패턴 확인 시).
- **N5/F2 (high, 2회 반복) = OUT_OF_SCOPE**: `send.ts`가 명시적 `recipients: []`를 생략과 동일 취급해 task/type 기본수신자 폴백. **spec D6이 폴백을 비-UI 호출자용으로 보존 명시**·pre-existing(이 브랜치 미수정)·UI는 항상 명시 발송·폴백은 설정값(임의 아님). follow-up=route schema 명시 `[]` 거부(선택).
- **N4-server (high, 반복) = OUT_OF_SCOPE**: `saveRoundDate`가 BillingConfig 존재 미확인·FK 없음 → configure 권한자 직접 PUT로 orphan 회차일. pre-existing `billing-config.ts`·D1·UI 벡터는 N4-UI로 차단·configure 게이트. follow-up=서버 config-존재 가드/FK.
- **N1 (medium) = OUT_OF_SCOPE**: HQ_REQUESTED가 목록 필터(진행중/발송) 누락 → '전체'에서만 보임. pre-existing generic FILTERS(전 kind 공통, 이 브랜치 미수정)·HQ_REQUESTED=빌링 슬라이스 종단상태(최종발송=후속). follow-up=3단계(최종발송) 구현 시 필터 재검토.

**핵심 불변식·교훈:**
- codex가 매 라운드 인접 영역 신규 finding 양산(churn): download→send폴백→stale prefill→list필터→FINAL_SENT→mail drift→orphan rounds→create grant. 대부분 **pre-existing 백엔드/마이그레이션이 새 UI 기대를 서버에서 강제 안 함** 패턴. F1만 사용자가 서버강제 승인(보안·spec 무언급 갭), 나머지 spec 명시결정/pre-existing은 OUT_OF_SCOPE·ACCEPTED.
- **다운로드 가능 상태 = GENERATED/REVIEWED/SENT/HQ_REQUESTED/FINAL_SENT(생성후·미취소)**. NOTIFICATION_BILLING은 REVIEWED 실제 경유. UI 다운로드는 `isBilling`(BILLING만). 서버·UI 단일출처 `policy.isDownloadableStatus`.
- env 주입 필수: vitest가 `.env` 미로드 → `set -a; source .env; set +a; npm test`(아니면 `@/lib/env` parseEnv가 DATABASE_URL 누락으로 1파일 import 실패).
- 무스키마변경(표준 restart). 배포 시 db:seed가 N6 create-upgrade 적용 → 기존 DB pm create 부여 확인 필요.

**머지 완료**(PR #29, 98c1d9a) + **kgs-dev 배포 완료**(2026-07-01). 배포 시 dev가 PR #27(5991365)에 머물러 있어 pull이 **billing-backend(add_generation_lock 마이그레이션, 별도 PR로 main 선머지)** + 우리 UI를 함께 가져옴 → `migrate deploy`가 `20260629142806_add_generation_lock` 적용(**additive=컬럼 추가, full-stop 불필요·표준 restart 유지**). db:seed로 catalog(workflows.billing 5 actions)+N6 create-upgrade 적용. **N6 DB 검증 통과**: `kernel."RolePermission"` 조회 결과 **pm=workflows.billing:create ALLOW**(admin도 ALLOW, regular-developer·contractor 3종=DENY, deny-first 설계대로). HTTP smoke green: /login 200, /api/calendar/feed·/api/workflows·/api/leave/calendar 401(P2010 없음), pm2 unstable restarts 0·에러로그 공백. 잔여=**인증 후 시각 smoke**(pm 로그인 → 생성 버튼/다운로드 status 게이트/회차표 게이트, LAN 172.21.10.27:3200 또는 Tailscale 100.66.58.66:3200).
