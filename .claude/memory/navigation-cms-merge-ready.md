---
name: navigation-cms-merge-ready
description: navigation-cms·팔레트·advisory-lock fix·사이드바 트리(PR#13) 전부 main 머지+dev 배포 완료(2026-06-23); NAV 변경 시 배포에 db:seed 필수
metadata:
  node_type: memory
  type: project
  originSessionId: 42502813-e08f-4872-bded-25a9479c07e1
---

2026-06-23 기준 **main(6990f4a)에 모두 머지 완료**:
- **PR #10** navigation-cms(메뉴 관리, 11태스크) + 사이드바 nav-* 색 토큰.
- **PR #11** 프로페셔널 블루 팔레트 전환 + calendar/leave/card/layout 리스타일([[ops-hub-palette-direction]]).
- **PR #12** advisory lock `$queryRaw`→`$executeRaw` 버그픽스.
- **PR #13** 사이드바 트리 중메뉴(연차 5자식: 대시보드/신청/캘린더/내역/관리 → `/leave/manage/*`; 관리 자식: 사용자관리/메뉴관리). 마이그레이션 없음.

**advisory lock 버그(중요 교훈):** `pg_advisory_xact_lock`은 `void` 반환 → `$queryRaw`는 P2010(void 역직렬화)로 throw. navigation reorder/reparent/cascade·leave 신청이 실DB에서 실패했음(단위테스트는 prisma mock이라 못 잡음 — **raw SQL·advisory lock은 dev 실DB 검증 필수**). admin/users는 `$executeRaw`로 올바르게 호출 중이 reference였음. dev에서 `$executeRaw` OK / `$queryRaw` P2010 직접 대조로 확정.

**dev 배포 상태:** kgs-dev `/home/kgs/apps/ops-hub`가 **main(6990f4a) 체크아웃**으로 서빙 중(pm2 ops-hub :3200, PR#10~13 전부 반영). `NEXTAUTH_URL`=LAN(172.21.10.27:3200)이라 폰/Tailscale 로그인은 막힘(사무실 LAN 전용 — 폰 쓰려면 .env 100.66.58.66로 바꾸고 restart). git identity 없으니 머지 시 `git -c user.name=.. -c user.email=.. merge`.

**배포 교훈(중요):** NAV(`src/kernel/access/catalog.ts`)는 부트스트랩 시드일 뿐, 런타임 메뉴 진실원은 DB(`loadNavigation`). 코드만 배포(build)하면 **기존 DB에 새 메뉴가 안 뜬다** — 배포 절차에 **`npm run db:seed` 필수**(seedNavigation=create-if-absent로 새 key만 생성, 기존 편집 보존, D3). PR#13 배포 때 leave 5자식+admin-users가 이 경로로 등록됨. (마이그레이션 없어도 NAV 변경이면 seed 필요.)

**남은 브랜치(origin):** `main` / `fix/admin-submenu-tabs`(admin 서브탭 = admin-tabs.tsx, deferred task-11 Step 4 — 유지) / `chore/migrate-al-users`(⚠️ **main에 없는 미머지 마이그레이션 스크립트** `scripts/migrate-al-users*.ts/py`·설계 — annual-leave 사용자 이관 도구, [[annual-leave-users-migrated]]. 삭제 금지, 차후 main 편입 또는 보존 결정).

**남은 후속 작업:**
1. **디자인 차후 전체 재정리**(사용자 결정 2026-06-23) — 현 팔레트는 interim 베이스라인. admin 셸 리팩터(admin-links 삭제·/admin 리다이렉트·h1 제거)도 admin-tabs 통합과 함께 이때.
2. `.env.example`이 **main에 미추적**(별건 경미) — 복원 검토.
3. (무해) href 스키마 자식 null-href 허용 → AppNav 죽은 `#` 링크.

관련: [[session-per-merge-workflow]] [[ops-hub-palette-direction]].
