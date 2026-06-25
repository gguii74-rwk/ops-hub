---
name: leave-notification-toggle-pr
description: 연차 알림 메일 발송 토글 + 설정 메뉴 노출 SDD → PR #24 머지(0e24f5f)+kgs-dev 배포·검증 완료. 표현계층 + enqueue 게이트만, db:seed로 권한·nav·pm grant 등록.
metadata:
  type: project
---

연차 신청/승인/반려 3개 이벤트 알림 메일을 관리자가 설정 화면에서 이벤트별 토글하게 하고, 사이드바 "관리" 트리에 누락된 "설정" 항목을 노출. SDD 5태스크 완료 → **PR #24 머지 완료**(merge commit `0e24f5f`, base main, 2026-06-25), 브랜치 `feat/leave-notification-toggle`(main `2214aff`에서 분기, 5커밋 `46d0584`→`2cb37ec`).

**아키텍처**: 표현계층(설정 카탈로그·에디터·메뉴) + 연차 서비스 **enqueue 시점 게이트**만. OFF면 서비스가 repository에 `mailJob=null` → 기존 `if(mailJob)` 가드가 enqueue 자동 스킵. repository·트랜잭션·발송 워커·도메인 불변식(usedDays·status-CAS) **무변경**, **Prisma 마이그레이션 없음**.

**핵심 결정(재논의 말 것 — plan R1~R5에서 판정)**: D2 OFF=outbox 미적재(enum 추가 X). D3 `createLeaveRequestByAdmin` 무변경(getSetting 미조회). D4 미설정→기본 ON / 읽기 예외→**fail-closed(미발송)** + 마커 `LEAVE_NOTIFICATION_SUPPRESSED_BY_SETTINGS_READ_ERROR` error 로그. D6 쓰기=base `admin.settings:configure`(API route) + entry `leave.admin:configure`(도메인 스코프). 토글=best-effort enqueue preference(규정용 kill-switch 아님 — in-flight/큐된 메일은 발송, ACCEPTED). 게이트는 `=== true`만 발송.

**권한 토폴로지**: OWNER(systemRole 자동) + `pm`이 `leave.admin:configure` 보유, 위임 user-admin은 미보유(메뉴는 보이나 토글 항목 필터+쓰기 403). fresh install=bootstrap이 pm grant, 기존 DB=task-05 upgrade-once(`migration.leave-notifications.upgrade.applied` 플래그, pm만, fail-closed).

**검증**: typecheck/lint/test(**1380/1380**) green·pristine, opus 최종 whole-branch 리뷰 Ready-to-merge(D6 이중게이트·메뉴↔집행·게이트키 일치·권한 수명주기 독립검증), no-AI-trace. **codex impl 적대검증(review-loop, 1라운드, 2026-06-25)**: high 2건 모두 **ACCEPTED=D4 재지목**(① 설정 읽기예외→silent 메일억제, ② `fallbackSafe:true` 무효값→default ON). `getSetting`(service.ts:44-56) 코드가 D4 충실 구현 확인 — 미설정/무효값→default ON, 읽기예외→throw→`notificationsEnabled` catch→false. 자동수정 시 D4 사용자 결정 역전이라 FIX 금지. 미판정 blocking 0, 코드 변경 없음.

**배포 주의(중요)**: 마이그레이션 없음=표준 restart. 단 `npm run db:seed` **필수** — ① nav `admin-settings` 등록, ② `leave.admin:configure` Permission 등록 + 기존 DB pm grant(upgrade-once). 누락 시 메뉴 미노출/토글 권한 OWNER 한정.

**배포 완료(2026-06-25)**: kgs-dev 표준 restart(마이그레이션 0). git→ci→generate→migrate(no-op)→`db:seed`→build→`pm2 restart` 모두 OK. **DB 검증**: `leave.admin:configure` 권한 존재, **pm `ALLOW/all` grant(upgrade-once)**, nav `admin-settings`→`/admin/settings`, 멱등 플래그 `migration.leave-notifications.upgrade.applied` set. smoke: `/login` 200, `/api/auth/permissions` 401(인증경로 정상, P2010 무). **잔여(수동)**: 사무실 LAN `http://172.21.10.27:3200`에서 pm 계정 로그인 → "관리>설정"에 연차 토글 3개 노출·on/off 시각 확인(NEXTAUTH_URL=LAN). 폰 확인 시 서버 `.env` NEXTAUTH_URL→100.66.58.66 전환 후 restart. 관련: [[session-per-merge-workflow]] [[no-ai-trace-in-review-loop-output]] [[dev-deploy-stale-build-p2010]].
