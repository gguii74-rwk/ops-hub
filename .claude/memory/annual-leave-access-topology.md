---
name: annual-leave-access-topology
description: "기존 annual-leave는 kgs-dev에서 프론트:3000/백엔드:5000 분리 배포, 브라우저가 백엔드 직접호출(IP별 분기)이라 Tailscale 접속은 로그인이 안 됨"
metadata: 
  node_type: memory
  type: reference
  originSessionId: b1e77769-fb8e-4889-b37d-4cb4938b2ea2
---

기존 연차 시스템(annual-leave)은 cutover 대상 kgs-dev(`172.21.10.27` / Tailscale `100.66.58.66`)에서 **`root` 계정 `/opt/annual-leave`** 로 배포되어 있고, 우리 작업(ops-hub=`kgs`/`:3200`, day-sync=`daysync`/`:3100`)과 계정·경로·포트가 완전히 분리됨. PM2(`/root/.pm2`)가 두 프로세스 관리: `annual-leave-frontend`(Next, cluster, `:3000`) + `annual-leave-backend`(Express, `tsx src/server.ts`, fork, `:5000`).

**핵심: 프론트가 백엔드를 프록시하지 않는다.** 로그인 등 API는 브라우저가 axios로 백엔드(`:5000`)를 **직접** 호출한다. base URL은 클라이언트에서 `window.location.hostname`으로 분기(`frontend/src/lib/api.ts` `getApiUrl()`):
- 공인 `121.183.194.245` → `http://121.183.194.245:15301/api` (외부/재택 접속 경로로 추정 — cutover 메모리의 "172.21.10.27 외주 유일경로" 서술과 교차검증 필요)
- LAN `172.21.10.27` → `http://172.21.10.27:5000/api` (사무실)
- `localhost`/`127.0.0.1` → `http://localhost:5000/api`
- 그 외(SSR/빌드 fallback) → `NEXT_PUBLIC_API_URL`(=`http://172.21.10.27:5000/api`, 빌드타임 인라인)

**Tailscale IP(`100.66.58.66`) 분기가 없다** → Tailscale로 접속하면 프론트(`:3000`)는 HTTP 200으로 떠도, 브라우저 로그인 요청이 LAN `172.21.10.27:5000`으로 가서 집(LAN 도달 불가)에선 axios "Network Error". DevTools에서 Referer `100.66.58.66:3000` + Request URL `172.21.10.27:5000/api/auth/login`로 확정(2026-06-20). 시스템 자체는 정상(6개월 가동, 마지막 커밋 2025-12-12, 우리 작업 무관). 백엔드 `:5000`은 Tailscale `100.66.58.66:5000`으로 **도달은 됨**(서버 살아있음).

**How to apply:** 집에서 기존 시스템 봐야 하면 Tailscale 말고 사무실 LAN(`172.21.10.27:3000`)이나 공인 IP(`121.183.194.245`) 경로로 접속. Tailscale 지원이 필요하면 `api.ts`에 `100.66.58.66` 분기 1줄 추가 후 frontend 재빌드 + `pm2 restart annual-leave-frontend`(운영 변경이라 승인 후). cutover 시 ops-hub는 이 IP별 하드코딩 분기 대신 상대경로/리버스프록시로 가면 이 문제 자체가 사라짐. [[ops-hub-cutover-target]] [[ops-hub-phone-test-via-dev-deploy]]
