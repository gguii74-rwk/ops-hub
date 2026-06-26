---
name: settings-redesign-spec
description: "설정 페이지 재설계 + 연동 상태 진실화 PR-A = PR #25 머지(bf8f9c4) + kgs-dev 배포 완료(2026-06-26); Google CRUD는 PR-B"
metadata: 
  node_type: memory
  type: project
  originSessionId: 30a8b151-2ae8-4b37-a345-62c2e813c697
---

`/admin/settings` 재설계 + 연동 상태 진실화 spec 완료(2026-06-26). 발단: "메일은 발송되는데 상태는 '설정 필요'" 모순 + 옵션 난립.

**근본 원인:** SMTP 설정(host/from)은 DB SystemSetting 편집 가능하지만 실제 전송(`src/lib/integrations/mail`)은 env(`SMTP_HOST`…)만 읽어 DB는 死 설정. Google calendarIds도 동일(동기화는 `CalendarSource` 테이블 사용).

**브랜치/문서:** `feat/settings-redesign`(미push, 커밋 14, HEAD b83b45a) · spec `docs/specs/2026-06-26-settings-redesign-design.md`(D1~D11·F1~F13) · plan `docs/plans/2026-06-26-settings-redesign.md`(엔트리포인트+task-01~07, plan ledger P1~P6 포함).

**PR-A 범위:** IA를 group별 카드로 재편(상단 요약카드 제거→헤더 배지). SMTP는 host/user/secure/password/**port=env 전용**(host=F4 비밀번호 유출 차단, **port=D11/A2 port/TLS 드리프트 차단**), **DB편집은 fromAddress 하나뿐**·전송 배선(`getSmtpConfig` kernel, 타입은 lib=경계안전, tolerant/throw금지). 상태는 전송 auth분기와 일치. 편집기 타입분기(string/number/list). **마이그레이션·seed·권한 무변경**(표준 restart + fromAddress cutover preflight).

**PR-B(별도 세션):** `/admin/settings/calendar-sources` CalendarSource CRUD + calendarIds→relational + seed create-only cutover + googleConfigured 소스카운트. externalId(PII)는 configure 권한에만 노출.

**핵심 사용자 결정:** ① SMTP 민감필드 env 유지(유출 차단). ② Google 전환 전체를 PR-B로(PR경계 관리공백 제거). ③(plan단계) **port도 env 전용(A2)** — port/TLS 결합 드리프트 제거, DB편집 SMTP=fromAddress뿐. ④ cutover=**수동 preflight(B1)** — restart 전 fromAddress 행 확인(저장소 배포가 전부 수동이라 일관).

spec review-loop 7R(미판정0) **+ plan review-loop 5R(R1~R5, max도달, 미판정0)**: FIXED P1(from검증)·P3(port→env/A2)·P4(spec SSOT reconcile/D11)·P5(SMTP_PORT 빈문자열→port0 가드)·P6(D5/D6 Google상태 분리), ACCEPTED P2(cutover B1). no-AI-trace 확인(docs+커밋).

**IMPL 완료(2026-06-26, subagent-driven-development 7태스크):** 8 impl 커밋 `b83b45a..559b976`(미push, 사용자 선택=**브랜치 그대로 유지**). 01 카탈로그 IA(host+port 제거 6sys/12)·02 MailTransportConfig+sendMail(config?)·03 getSmtpConfig(P5 port가드·P1 from검증·tolerant)·04 호출자 배선·05 상태진실화(auth분기 F9·secret.smtp not_required F12)·06 편집기 타입분기·07 그룹카드 페이지. 각 task TDD+sonnet 리뷰 통과, **최종 opus whole-branch 리뷰 merge-ready**, impl-phase **codex 적대검증 1R**=유일 high가 P2 재지목→DUPLICATE(B1 기결정). **게이트: typecheck/lint/build green, test 1413/1413(`.env` 로드 필수 — @/lib/env parseEnv가 import 시점 검증, 미로드 시 2 suite 로드실패로 실제실패 가림 ← task-04에서 실증).** no-AI-trace clean. SDD ledger=`.superpowers/sdd/progress.md`.

**IMPL review-loop 2차(2026-06-26, 새 세션, base b83b45a):** codex needs-attention, medium 2건 모두 **ACCEPTED**(미판정0·코드무변경·HEAD 559b976 그대로). ① "무효 SMTP_PORT 조용히 587" = D11/A2·D5/F9·P5(테스트고정)·spec line132 configured 계약("배지=발송보장 아님, 라이브 핸드셰이크 필요")·status는 port 미관여(line167); 권고(port→attention)는 §10 후속 "연결 테스트"로 이미 분리. ② "타입 편집기(string/number/list/json)가 409 refetch에 router.refresh 안 함" = 158행 의도된 입력보존 트레이드오프, 낙관적잠금 fail-closed·토스트 안내; **사용자 결정=현행 유지**(codex 원안 router.refresh는 초안 손실로 비채택). 둘 다 "codex는 spec결정/사용자결정 모름" 케이스.

**머지+배포 완료(2026-06-26):** PR **#25 머지**(merge commit `bf8f9c4`, main) + **kgs-dev 표준 restart 배포**(D9 무마이그레이션·무seed) 완료. **preflight(P2/B1) 통과**: `fromAddress` 행 없음→env 폴백(`SMTP_FROM=ggui74@uracle.co.kr`) 안전; orphan `integrations.smtp.port=587` 잔존하나 D11대로 무해(catalog 미참조). 배포 게이트: ff `0e24f5f→bf8f9c4`·npm ci·prisma generate·build·pm2 restart(ops-hub online ↺20). **HTTP smoke 통과**: `/login` 200·`/signup` 200·`/`307→login·`/admin/settings` 307→login(auth게이트)·`/api/calendar/feed` **401**(DB·auth 라우트 크래시 없음=P2010 stale-build 해소 신호)·pm2 `✓ Ready`만. **잔여=인증 후 시각 smoke(사용자 수동)**: 브라우저 `http://172.21.10.27:3200`(NEXTAUTH_URL=LAN) 로그인→`/admin/settings` 그룹카드·상태배지 + 실제 발송 1건(fromAddress).

**⚠ 배포 LESSON(preflight psql):** opshub DB는 Prisma **multiSchema** — `SystemSetting`은 `public`이 아니라 **`kernel."SystemSetting"`**(스키마: calendar/kernel/leave/workflows/public). `?schema=public` 제거만으론 부족(search_path 기본값이라 미발견) → **스키마 한정 필수**. (CLAUDE.md "psql ?schema 제거" 노트 보완점.)

**follow-up:** SMTP/Google 라이브 "연결 테스트" 액션(finding1 권고 정식 해소처), enforced cutover 스크립트(선택), **PR-B Google CalendarSource CRUD**(별도 세션). 관련: [[session-per-merge-workflow]]
