---
name: dev-deploy-stale-build-p2010
description: kgs-dev 배포 시 stale 빌드가 advisory-lock 경로에서 P2010(void) 사일런트 크래시 — 인증 라우트 smoke 필수
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2a2528fa-9446-434b-b81c-08ce05feee9c
---

2026-06-24 PR #19 dev 배포 중 발견: kgs-dev pm2 `ops-hub`가 **수정 전(93d0cec 이전) stale 빌드**를 돌리고 있었고, advisory lock을 `$queryRaw\`SELECT pg_advisory_xact_lock...\`` 로 호출 → Prisma가 void 컬럼 역직렬화 실패(**P2010 "Failed to deserialize column of type 'void'"**). 그 결과 advisory lock을 잡는 **인증/뮤테이션 경로**(signup-cap·leave 승인/반려·권한 매트릭스 setCell·nav reparent)가 사일런트로 깨져 있었음. 비인증 경로(/login)는 멀쩡해 이전 smoke(/login 200)가 이걸 못 잡음.

**Why:** ① `pm2 restart`(rolling)는 `npm ci`+`build`로 디스크 청크가 바뀐 뒤에도 옛 next-server 프로세스가 메모리의 옛 청크로 계속 서빙 → git/디스크는 최신인데 런타임은 stale. ② 93d0cec("advisory $queryRaw→$executeRaw")가 코드엔 있어도 런타임 빌드가 그 전이면 무력. ③ pm2가 `npm run start`를 감시하면 부모 npm만 보고 자식 next-server가 죽어도 status=online으로 보임(20MB=npm만).

**How to apply:** ① 배포 smoke에 **인증 + advisory-lock 라우트**(예: 로그인 후 권한 매트릭스 셀 편집 or leave 승인)를 반드시 포함 — /login 200만으로 부족. ② 배포 후 `~/.pm2/logs/ops-hub-error.log`에서 P2010/void/Prisma 에러 grep. ③ 빌드 청크 SQL 확인: `.next/server/chunks/*` 에서 `grep -aoE ".{18}pg_advisory_xact_lock"` → 반드시 `executeRaw\`SELECT pg_advisory_xact_lock`. ④ 디버그 시 에러 스택의 청크명이 현재 `.next` 에 **없으면** = 옛 프로세스가 옛 청크로 도는 중(=stale). 빌드 mtime(`.next/BUILD_ID`) vs 에러로그 mtime 대조. 모든 `$queryRaw`의 void-함수 호출은 `$executeRaw`로([[laptop-sync-stale-artifacts]]와 별개 이슈).
