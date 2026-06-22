# 운영전환(cutover) 접속·인증·암호화 설계

> 상태: **결정 확정 (2026-06-22)** · 구현은 별도 plan(`writing-plans-split`)으로 진행
> 관련: [`initial-migration-plan.md`](initial-migration-plan.md)(데이터 이행) · `workspace-env/INVENTORY.md`(네트워크·포트 SSOT) · ADR-0002(access-control)

ops-hub를 운영전환(annual-leave 대체)할 때 **운영팀 약 15인이 내부(개발자)·외부(재택: 콘텐츠팀·민원팀)에서 동시에** 사용하기 위한 접속·인증·전송보안 설계. 별도 도메인 신청 없이 기존 annual-leave의 접속 경로를 계승하는 것을 전제로 한다.

## 1. 접속 토폴로지

| 사용자 | 경로 | 비고 |
|--------|------|------|
| 내부(개발자, 사무실 LAN) | `http://172.21.10.27:<port>` 직접 | 사이트 LAN 직결 |
| 외부(재택: 콘텐츠팀·민원팀) | `121.183.194.245:15300` → 사이트 방화벽 **포트포워딩** → `172.21.10.27:<port>` | annual-leave가 현재 쓰는 그 경로 |

- 내부·외부가 **서로 다른 host:port**로 같은 서버에 닿는다(단일 canonical 호스트 아님). 포트포워딩은 L4 NAT라 **HTTP `Host` 헤더를 보존**한다 — 이 사실이 아래 인증 설계의 전제.
- cutover 시 ops-hub가 annual-leave의 이 엔드포인트를 이어받는다(annual-leave는 읽기전용→중단). 포트포워딩 타깃 포트 변경은 사이트 네트워크팀 작업.

## 2. 결정 D1 — 인증: `trustHost` + `NEXTAUTH_URL` 제거 (코드 변경 없음)

**배경.** NextAuth는 `NEXTAUTH_URL`이 설정돼 있으면 그것을 리다이렉트·쿠키·메일링크의 canonical base로 **우선** 사용한다(`trustHost`는 URL 미설정 시에만 요청 Host 신뢰). 그래서 단일 `NEXTAUTH_URL`로는 내부/외부 두 주소 중 하나만 동작한다(2026-06-22 dev에서 실측: LAN 접속이 폰 IP로 리다이렉트되어 타임아웃).

**결정.** `src/lib/auth/config.ts`는 이미 `trustHost: true`다. 운영에서 **`NEXTAUTH_URL`(및 `AUTH_URL`)을 설정하지 않는다** → Auth.js가 **요청 Host 기준**으로 URL을 구성 → 내부(`172.21.10.27`)·외부(`121.183.194.245:15300`)가 각자 자기 주소로 로그인·이동하여 **동시 사용**된다. `secret`은 `NEXTAUTH_SECRET ?? AUTH_SECRET`이라 영향 없음. env 스키마(`src/lib/env`)는 `NEXTAUTH_URL`을 요구하지 않으므로 제거해도 기동 검증은 통과한다.

**전제 조건 — self-service 가입 비활성.** canonical base URL(`AUTH_URL`/`NEXTAUTH_URL`)을 읽는 코드는 `src/modules/admin/users/base-url.ts`의 `buildVerifyLink`뿐이고, 호출처는 **`/api/auth/signup`·`/api/auth/resend-verification` 둘뿐**이다(둘 다 self-service 가입). `NEXTAUTH_URL`이 없으면 이 함수가 throw하므로, 운영에서는 **가입 흐름을 비활성**한다:
- 비활성 대상: `/signup` 페이지·네비, `/verify-email`, `/api/auth/signup`, `/api/auth/resend-verification`.
- 그 외 메일은 canonical에 의존하지 않는다 — 관리자 승인/거절 메일은 **텍스트(링크 없음)**, 연차·워크플로 알림 메일도 `NEXTAUTH_URL` 미사용(확인됨). 따라서 가입만 끄면 멀티호스트 인증이 **설정만으로** 성립한다(B안 allowlist 코드 변경 불필요).

**검증 포인트(구현 시).** 리버스 프록시(아래 D3)를 두면 프록시가 `X-Forwarded-Host`·`X-Forwarded-Proto`를 정확히 전달해야 `trustHost`가 올바른 origin(https)을 구성한다.

## 3. 결정 D2 — 온보딩: annual-leave 시드 + 관리자 생성 (self-service 미사용)

가입을 끄는 대신 계정을 **관리자 주도**로 운영한다.

- **초기 적재**: `D:\workspace\annual-leave`(SQLite) 가입자 데이터를 **이메일을 병합 키**로 ops-hub에 적재한다(이미 [`initial-migration-plan.md`](initial-migration-plan.md) 방침과 정합). 생성 상태 = `ACTIVE` + `mustChangePassword=true`(최초 로그인 시 본인 비번 설정). `employmentType`(REGULAR/CONTRACTOR)·`jobFunction`(PM/DEVELOPER/CONTENT_MANAGER/CIVIL_RESPONSE) 매핑 규칙을 적재 스크립트에 정의.
- **신규/추가 계정**: 관리자 UI의 사용자 생성(`createUserByAdmin`) — 관리자가 비번 지정 → 즉시 `ACTIVE`(이메일·링크 없음). 비번 분실 시 관리자 재설정(`resetPassword`)이 **임시 비번을 화면에 1회 노출**(링크 없음) → 사용자에게 전달.
- **확장 시**: 부서 확대·정식 규모 확장 시 self-service 가입을 다시 켜고, 그때 **단일 도메인(D-ext)**을 도입하면 멀티호스트 제약·가입 링크 문제가 자연 해소된다.

## 4. 결정 D3 — 전송 암호화: 리버스 프록시 TLS (self-signed / 사내 CA)

**아키텍처 정정.** ops-hub는 **모놀리스**(브라우저 ↔ Next.js 단일 서버)다. annual-leave식 front(3000)/back(5000) 분리 hop이 없으므로 "front→back 구간 암호화"가 적용될 내부 hop은 없다. 실제 평문 위험 구간은 **외부 사용자 브라우저 ↔ 서버(공개 인터넷, 현재 `http://121.183.194.245:15300`)** — 로그인 비번이 평문으로 인터넷을 지난다.

**결정.** 도메인 없이 이 구간을 암호화하기 위해 **리버스 프록시(nginx 또는 caddy)에서 TLS 종단**한다.
- 인증서: **self-signed 또는 사내 CA**로 발급. CN/SAN에 **IP를 넣는다**(`121.183.194.245` + `172.21.10.27` 둘 다 SAN에 포함하면 단일 인증서로 내부·외부 모두 커버). `mkcert` 같은 도구로 로컬 CA+IP 인증서 발급이 간편.
- 클라이언트: 사내 CA 루트를 **15인 사용자 PC에 1회 설치**하면 브라우저 경고 없이 https. (소규모라 운용 가능.)
- 배치: 프록시가 TLS 종단 후 ops-hub(localhost:3200)로 평문 프록시. **내부·외부 모두 프록시 경유**를 권장(쿠키 보안 일관성). 외부 포트포워딩(`121.183.194.245:15300`)의 타깃을 ops-hub 직접이 아니라 **프록시의 TLS 포트**로 변경(사이트 네트워크팀).
- 프록시 헤더: `X-Forwarded-Proto: https`, `X-Forwarded-Host: <원본 host>`를 전달 → `trustHost`가 https origin·secure 쿠키를 정확히 구성(D1과 연동).

> 내부 LAN 구간만 평문 유지(프록시 미경유)도 위험은 낮지만, http/https 혼용 시 secure 쿠키가 origin별로 갈리므로 **내부도 TLS 경유로 통일**하는 편을 권장.

## 5. cutover 절차에 미치는 영향 (요약)

1. annual-leave를 읽기전용→중단, ops-hub가 `172.21.10.27`의 운영 포트(또는 프록시 TLS 포트)를 점유.
2. 사이트 방화벽 포트포워딩 `121.183.194.245:15300 → 172.21.10.27:<proxy-tls-port>`로 변경(네트워크팀).
3. ops-hub `.env`에서 **`NEXTAUTH_URL` 제거**, 가입 라우트·네비 비활성, 프록시(TLS) 기동.
4. annual-leave 데이터 적재(이메일 병합키, `ACTIVE`+`mustChangePassword`).
5. 검증: 내부(LAN)·외부(포워딩) 양쪽에서 로그인→대시보드, secure 쿠키, 관리자 사용자 생성/비번재설정.

세부 데이터 이행 절차·검증 기준 row 수는 [`initial-migration-plan.md`](initial-migration-plan.md).

## 6. 규모 확장 시 (참고)

부서 확장·정식 운영으로 키우면 **단일 도메인 + 공인 HTTPS(443)**로 전환한다(split-horizon DNS: 내부→LAN IP, 외부→공개). 그러면 `NEXTAUTH_URL`을 그 도메인 하나로 고정해도 내부·외부가 같은 호스트라 충돌이 없고, self-service 가입·메일 링크도 자연 동작한다. self-signed 인증서·가입 비활성 같은 소규모 운용 제약이 모두 사라진다.

## 부록 — 현재 dev 설정과의 차이

dev(kgs-dev:3200)는 **테스트 편의상** `NEXTAUTH_URL`을 단일 호스트로 고정해 쓴다(2026-06-22 기준 LAN `http://172.21.10.27:3200`; 폰 테스트 시 `100.66.58.66:3200`로 전환). 이는 운영 설계(`NEXTAUTH_URL` 제거 + trustHost)와 다르며, dev에서만의 임시 운용이다. 방화벽도 dev는 3200을 public+tailnet 양쪽에 열어둔 상태(INVENTORY 기록).
