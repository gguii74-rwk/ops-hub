---
name: user-management-merge-ready
description: feat/user-management는 구현·통합리뷰 모두 수렴(미판정 blocking 0)·1002 테스트 통과로 main 머지 준비됨; 배포 시 follow-up 4종 필수
metadata:
  type: project
---

`feat/user-management` 브랜치(사용자 관리 ①계정 수명주기 + 관리자 사용자 관리, plan `docs/plans/2026-06-21-user-management.md`)는 **main 머지 준비 완료** 상태다. task-01~09 + per-task review-loop + 최종 통합 review-loop 5회 수렴, **미판정(unadjudicated) blocking 0**(FIXED 10 / DEFERRED 1). 통합리뷰 종료 HEAD=`38e8e23`, 게이트 재검증 = **1002 passed/108 files** + typecheck·lint·build·prisma:validate clean.

**머지 시 주의:** ① main이 +1(`9f4eec4` docs/memory 동기화) — 양쪽 CLAUDE.md를 건드려 **CLAUDE.md 충돌 가능**. ② 브랜치에 user-mgmt와 무관한 워크플로 커밋(review-loop `--auto-rounds`·런북·CLAUDE.md docs)이 인터리브됨 — squash 또는 정리 고려.

**⚠️ 배포(DB 연결) 시 필수 follow-up:**
1. **email canonical 마이그레이션** `prisma/migrations/20260622000000_user_email_canonical_lowercase` 적용 — 적용 前 케이스-only 중복 신원 수동 정리(UPDATE fail-loud). lower(email) 표현식 유니크는 Prisma 미표현(drift 주의).
2. **사용자 메일 drain staleness recheck**(iter5 DEFERRED, 사용자 Option B) — `src/modules/leave/services/mail.ts` 사용자 메일(`leaveRequestId=null`) 분기에 userId + 이벤트별 발송직전 recheck(VERIFY_EMAIL 토큰현행·APPROVED/REJECTED 상태일치) + refreshVerifyToken 시 옛 VERIFY_EMAIL supersede.
3. **세션 무효화 multi-server 하드닝** — `loginAtMs`+`>=`는 단일서버 정확. 다중서버는 monotonic `sessionVersion`(User 컬럼+JWT+변경/리셋/disable increment) 권장.
4. 기존 deploy-deferred: db:seed·prisma:migrate·RateBucket TTL·XFF ingress 계약·수동 E2E(signup→verify→approve→login→must-change).

관련: [[session-per-merge-workflow]] [[review-loop-automation-philosophy]] [[ops-hub-cutover-target]]. 상세 원장은 `.superpowers/sdd/progress.md`(gitignore — local-only, 노트북 간 미동기화)·`.remember/remember.md`(untracked).
