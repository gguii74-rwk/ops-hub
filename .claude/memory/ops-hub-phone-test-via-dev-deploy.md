---
name: ops-hub-phone-test-via-dev-deploy
description: 휴대폰 ops-hub 테스트는 OMEN 로컬이 아니라 kgs-dev에 배포 후 Tailscale로 접속한다
metadata: 
  node_type: memory
  type: project
  originSessionId: a15523b2-1d98-4a2d-ab51-586a26bf68fa
---

ops-hub를 휴대폰으로 테스트할 때는 **OMEN 로컬 `next dev`(LAN)로 노출하지 않는다.** OMEN은 Tailscale 미가입이고 휴대폰(`iphone181` = Tailscale `100.118.105.47`)은 tailnet에 있으므로 LAN 직결로는 못 닿는다.

올바른 경로: **ops-hub를 kgs-dev 개발서버(`dev.safetyreport.go.kr`, LAN `172.21.10.27`, Tailscale `100.66.58.66`)에 먼저 배포**하고, 휴대폰은 **Tailscale로 dev 서버에 접속**한다. 즉 "휴대폰 테스트" 요청 = "dev 배포 + Tailscale 접속".

**Why:** 사이트 방화벽이 Tailscale 앱을 정책 예외로 허용(다른 ZTNA는 차단). 휴대폰의 유일한 도달 경로가 Tailscale 메시다. day-sync도 이 서버에 배포돼 있다.

**How to apply:** "휴대폰에서 보고 싶다 / 테스트하자"는 요청이 오면 LAN 노출을 시도하지 말고 dev 배포 파이프라인을 태운다. 포트는 운영 annual-leave `:3000`·day-sync `:3100`·postgres `:5432`(safety_report 운영, **절대 금지**)/`:5433`(opshub dev)와 충돌하지 않게 고른다. 인프라 SSOT = `workspace-env/INVENTORY.md`. 관련: [[ops-hub-cutover-target]]

**실제 배포 좌표(2026-06-19 최초 배포)**:
- 위치 `/home/kgs/apps/ops-hub` (kgs 계정), 프로세스 pm2 `ops-hub`, 포트 **3200**, 실행 `next start`(production build).
- 접속: 휴대폰 Tailscale `http://100.66.58.66:3200` (또는 MagicDNS `http://kgs-dev.tailc0eac9.ts.net:3200`). 로그인 `admin@uracle.co.kr` / `.env`의 `SEED_ADMIN_PASSWORD`.
- 서버 `.env`: OMEN `.env` 복제 + DATABASE_URL `:5432`→`:5433`(서버는 postgres 직접 연결, 터널 아님) + NEXTAUTH_URL=tailscale. Google 키·LibreOffice 경로는 서버에 없어 해당 통합만 비활성(UI/로그인/워크플로엔 무관).
- 재배포: `git fetch && reset --hard origin/<branch> && npm ci && prisma generate && npm run build && pm2 restart ops-hub`. 자동 갱신 아님(브랜치 스냅샷). pm2 save 했으나 reboot 생존엔 `pm2 startup` 별도 필요(미설정).
- **firewalld(중요, 2026-06-19 해결)**: 신규 dev 포트가 폰에서 "응답 없음"이면 firewalld부터 의심. 원인은 `tailscale0`이 firewalld zone 미할당이라 default `public`(3200 미개방) 규칙에 막힌 것. **`tailscale0`를 trusted zone에 영구 등록**(`sudo firewall-cmd --permanent --zone=trusted --add-interface=tailscale0 && sudo firewall-cmd --reload`)으로 **이미 해결** → 이후 tailnet 경유 dev 포트는 방화벽 추가 개방 불필요(LAN/public엔 비노출). 상세는 INVENTORY §1.5.
