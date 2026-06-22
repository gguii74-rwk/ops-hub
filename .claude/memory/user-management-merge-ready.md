---
name: user-management-merge-ready
description: "feat/user-management → main 머지 완료(b99c7d4, 2026-06-22, --no-ff 머지커밋); 배포 시 follow-up 4종 필수"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2f0b63fc-ac23-4bf4-af86-4cf079e6c9b6
---

`feat/user-management` 브랜치(사용자 관리 ①계정 수명주기 + 관리자 사용자 관리, plan `docs/plans/2026-06-21-user-management.md`)는 **2026-06-22 `main`에 머지 완료**(랜딩 커밋 `b99c7d4`, `--no-ff` 머지커밋, 히스토리 재작성 없음). 머지 전 `origin/main`(`9f4eec4` docs/memory 동기화)을 브랜치에 통합하고 **CLAUDE.md 충돌을 union 해결**(review-loop 최신 문구 유지 + origin/main의 codex spec-caveat·dev 배포 섹션 병합, 통합 머지커밋 `24b95cf`). 랜딩 커밋에서 게이트 재검증 = **1002 passed/108 files** + typecheck·lint·build·prisma:validate clean. origin/main 동기화됨. task-01~09 + per-task review-loop + 최종 통합 review-loop 5회 수렴, 미판정 blocking 0(FIXED 10 / DEFERRED 1).

브랜치 `feat/user-management`(로컬 24b95cf / origin cddb75c)는 main에 모두 반영됨 → **삭제 가능**(retire).

**dev 배포 완료(2026-06-22, kgs-dev :3200):** 서버 `/home/kgs/apps/ops-hub`를 main(b99c7d4)로 전환 → `npm ci`·`prisma generate`·`migrate deploy`(pending 3건 적용, **email canonical 케이스중복 0이라 fail-loud 통과**)·`db:seed`·`db:seed:demo`·`next build`·`pm2 restart`. `/login`·`/signup`·`/verify-email`→200, 공휴일 data.go.kr sync 정상. 접속: Tailscale `100.66.58.66:3200` / LAN `172.21.10.27:3200`. OWNER `admin@uracle.co.kr`(ACTIVE·강제변경X, 비번=서버 `.env` SEED_ADMIN_PASSWORD). **이건 dev 테스트 배포 — 운영 cutover(annual-leave :3000)는 별도 미시행.**

**dev 메일·Google 설정(day-sync 재사용, 검증 완료):** day-sync(`/etc/day-sync/day-sync.env`, 같은 서버서 정상 운영)에서 가져와 ops-hub `.env`에 적용. **SMTP** = `mail-inbound.uracle.co.kr:465` secure, USER/FROM `ggui74@uracle.co.kr`, PASSWORD는 day-sync `SMTP_PASS` 복사(키명 `SMTP_PASS`→`SMTP_PASSWORD`) — nodemailer verify+실발송 성공. **Google** = day-sync SA 키 `neural-hour-420606-...json`을 `keys/google-sa.json`(kgs 600)로 복사 + **`GOOGLE_APPLICATION_CREDENTIALS`** 설정(코드가 읽는 변수, 옛 `GOOGLE_CREDENTIALS_PATH` 무시 — migration doc 06/09 함정 #5) — 공휴일 캘린더 조회 성공. 시드 CalendarSource는 `holiday-kr`(Google 공개 공휴일) 1개; day-sync 개인/업무/휴가 캘린더는 미이식(휴가=내부 leave 대체). signup→verify 링크=NEXTAUTH_URL(100.66.58.66:3200) canonical + host 일치검사 → **폰 가입 E2E 가능**(LAN host는 mismatch, 로그인은 trustHost로 무관). day-sync 통합 분석문서 = `D:\workspace\day-sync\docs\migration\`.

**배포 follow-up 상태:**
1. ✅ **email canonical 마이그레이션** `20260622000000_user_email_canonical_lowercase` — dev 적용 완료(케이스중복 0). lower(email) 표현식 유니크는 Prisma 미표현(이후 `migrate dev` drift 제안 수용 금지). 운영 cutover 시 케이스중복 재확인 필수.
2. ⏳ **사용자 메일 drain staleness recheck**(iter5 DEFERRED, Option B·코드 미구현) — `src/modules/leave/services/mail.ts` 사용자 메일(`leaveRequestId=null`) 분기에 userId + 이벤트별 발송직전 recheck(VERIFY_EMAIL 토큰현행·APPROVED/REJECTED 상태일치) + refreshVerifyToken 시 옛 VERIFY_EMAIL supersede.
3. ⏳ **세션 무효화 multi-server 하드닝**(코드 미구현, 단일서버 dev엔 불필요) — `loginAtMs`+`>=`는 단일서버 정확. 다중서버는 monotonic `sessionVersion`(User 컬럼+JWT+변경/리셋/disable increment).
4. ⏳ **수동 E2E**(signup→verify→approve→login→must-change) 미수행 + RateBucket TTL·XFF ingress 계약 확인 잔여. db:seed·prisma:migrate는 dev 적용 완료.

관련: [[session-per-merge-workflow]] [[review-loop-automation-philosophy]] [[ops-hub-cutover-target]] [[laptop-sync-stale-artifacts]]. 상세 원장은 `.superpowers/sdd/progress.md`(gitignore — local-only, 노트북 간 미동기화)·`.remember/remember.md`(untracked).
