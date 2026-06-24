---
name: teams-permission-matrix-merged
description: 팀 모델 + scope=team + 역할↔권한 매트릭스(증분 ②) PR #15 머지 + dev 배포 완료(2026-06-24)
metadata: 
  node_type: memory
  type: project
  originSessionId: 30df74df-f0a7-40fd-8bb4-3fdd529237cc
---

`feat/teams-and-permission-matrix`(에픽 "사용자 관리+접근제어" 증분 ②) → **PR #15 머지 완료**(merge commit `3d10176`, 2026-06-24). 정식 `Team` 모델(1인 1팀)·팀장, `scope=team` 활성화(엔진+연차 소비처), 역할↔권한 매트릭스 편집기. `User.department`→`Team` expand→contract 마이그레이션.

머지 전 impl review-loop(codex 적대검증 R1~R12)로 보안 결함 다수 FIXED — 마지막 R9~R12에서 F-NN(critical, 매트릭스가 비특권 role에 admin.* 부여 차단)·F-OO/F-PP(high, team-scope override가 팀 이동/승인을 따라가는 교차팀 우회)·F-QQ(medium, teamId 생략 승인의 active-team 경계). test 1282/1282.

**✅ dev 배포 완료(2026-06-24, full-stop)**: kgs-dev `/home/kgs/apps/ops-hub` main@`3d10176`, pm2 `ops-hub` online, `/login` 200. 순서 = git pull→npm ci→prisma generate→build(fail-fast)→pm2 stop→**DB 백업**(`/home/kgs/backups/opshub-pre-pr15-20260624-084757.sql`)→migrate deploy(expand+drop department)→db:seed→db:seed:demo→smoke→pm2 start. 검증: permissions=48·roles=6·nav, admin.teams/roles 권한, `admin.roles:configure`는 어떤 role에도 0(OWNER 전용), 위임 admin D10 grant, department 컬럼 drop, Team 4개·teamId 17명. **운영 safety_report(:5432) 미접촉** — opshub(:5433)만.

향후 동종 배포 주의(비가역 `department` drop = 코드 롤백 불가 경계, F-T/F-LL settled): **`pm2 restart` 단독·rolling 금지**(old 바이너리가 department 참조 시 version skew outage). postinstall에 prisma generate 없음 → `npm run prisma:generate` 명시 실행. psql/pg_dump는 `?schema=public` 제거 + SQL 문자열은 `$$..$$` 인용. ⚠ `NEXTAUTH_URL`=LAN(172.21.10.27:3200) → **폰(Tailscale 100.66.58.66) 로그인 쓰려면 .env NEXTAUTH_URL 전환 후 restart**(기존 제약, 이번 배포 무변경). 롤백=백업 복원. 배포처 [[ops-hub-phone-test-via-dev-deploy]].
