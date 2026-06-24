---
name: cross-app-cookie-collision
description: 같은 호스트(IP)에서 day-sync·ops-hub가 Auth.js 기본 쿠키 이름을 공유해 세션 충돌 — ops-hub 전용 쿠키 이름으로 해결
metadata: 
  node_type: memory
  type: project
  originSessionId: ff43cc39-a49e-400e-89f4-ed05ebb805b9
---

dev에서 일반 사용자만 `/dashboard`가 `This page couldn't load`(500)로 깨진 원인(2026-06-22 확인): **권한 문제 아님**. day-sync(`:3100`)와 ops-hub(`:3200`)가 **둘 다 `172.21.10.27`**, 둘 다 `next-auth ^5.0.0-beta.30`, 둘 다 커스텀 쿠키 이름 미설정 → 기본 이름 `authjs.session-token` 동일. **쿠키는 포트를 구분하지 않아(RFC 6265)** 두 앱이 같은 쿠키를 공유·덮어씀. 시크릿이 달라 상대 쿠키를 받으면 `JWTSessionError: no matching decryption secret` → `auth()`가 깨진/id 없는 세션 반환 → `(app)` 레이아웃이 `getPermissionSummary(undefined)` → `prisma.findUnique({id:undefined})` 크래시. OWNER는 새로 로그인한 ops-hub 쿠키라 정상 → "관리자만 됨"으로 보였다.

**해결(commit 697455b, 브랜치 `fix/auth-cookie-name-collision`):** `authConfig.cookies`에서 sessionToken/callbackUrl/csrfToken을 `ops-hub.*` 전용 이름으로 분리(미들웨어·서버 공용 authConfig에 배치). 추가로 레이아웃·`/account/password`·`/login`을 `session.user.id` 기준 fail-closed(깨진 세션은 500 대신 `/login`, 루프 방지).

**dev 배포 완료(2026-06-22):** `fix/admin-submenu-tabs`에 merge(`071c388`)해 dev 배포(pm2 ops-hub). `/login`이 `ops-hub.csrf-token`/`ops-hub.callback-url` 세팅 확인, 재시작 후 크래시 0. ⚠ 쿠키 이름이 바뀌어 **기존 ops-hub 세션 전부 무효화 → 전원(OWNER 포함) 1회 재로그인** 필요(정상). 이후엔 day-sync 열려 있어도 멤버 접속 정상. main 머지는 미완(브랜치 상태).

**Why:** 같은 머신에 여러 Auth.js 앱을 IP:포트로 띄우면 쿠키 충돌은 구조적으로 재발한다. cutover로 ops-hub가 `:3000`(annual-leave 자리)로 이전해도 day-sync(`:3100`)와 공존하면 동일 함정.

**How to apply:** 한 호스트에 NextAuth 앱을 둘 이상 띄우면 **앱마다 고유 쿠키 이름**을 지정한다(기본 이름 공유 금지). 진단 시 `pm2 logs`에서 `no matching decryption secret`를 먼저 확인. 임시 우회는 해당 IP 쿠키 비우기/시크릿 창. 관련: [[ops-hub-cutover-target]] [[annual-leave-users-migrated]] [[laptop-sync-stale-artifacts]]
