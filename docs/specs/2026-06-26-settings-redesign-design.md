# 설정 페이지 재구성 + 연동 설정 진실화 설계

- 날짜: 2026-06-26
- 상태: 설계 승인 대기
- 범위: 관리 → 설정 화면(`/admin/settings`)의 정보 구조 재편, SMTP 설정을 UI(DB) 진실원으로 배선, 연동 상태 표시 진실화, 나열형 설정 리스트 편집기, Google 캘린더 소스 관리 화면 신설.

## 1. 배경 / 문제

현재 `/admin/settings`는 두 가지 문제가 있다.

1. **상태 표시가 실제 동작과 모순된다.** 상단 "연동 상태" 요약 카드가 "메일(SMTP): 설정 필요"로 뜨는데 실제 메일은 정상 발송된다.
   - 근본 원인: 실제 메일 전송(`src/lib/integrations/mail/index.ts`)은 SMTP 설정을 **환경변수**(`SMTP_HOST`/`SMTP_PORT`/`SMTP_FROM` 등)에서만 읽는다. 반면 상태 점검(`src/modules/integrations/status.ts`의 `smtpConfigured()`)은 **DB SystemSetting**(`integrations.smtp.host`/`fromAddress`)을 읽는데 이 값은 비어 있다(`""`).
   - 즉 UI에서 편집 가능한 SMTP host/port/발신주소 DB 필드는 **메일 전송에 전혀 쓰이지 않는 死(dead) 설정**이다. 같은 문제가 Google에도 있다 — `integrations.google.calendarIds` SystemSetting은 死 설정이고, 실제 동기화는 `CalendarSource` 테이블 행(`findSourcesByKind`)을 읽는다.

2. **옵션이 평면적으로 나열돼 관리가 비효율적이다.** `category`(security/integrations/workflows/leave) 단위로만 묶여 "integrations" 카드에 SMTP·Google·LibreOffice가 뒤섞이고, 나열형(`calendarIds`, `defaultRecipients`)은 raw JSON textarea(`[]`)로 노출된다.

## 2. 목표 / 비목표

**목표**
- 설정 화면을 **의미 있는 영역(group)별 카드**로 재편하고, 영역별 진실된 상태 배지를 둔다.
- SMTP 설정을 **UI(DB)를 진실원**으로 배선한다(메일 전송이 DB 설정을 읽음, env는 fallback). 비밀번호는 secret이므로 env 유지.
- 연동 상태 점검을 **실제 동작이 읽는 출처**와 일치시킨다.
- 나열형 설정을 **리스트 편집기**(행 추가/삭제)로 관리한다.
- Google 캘린더 소스를 **전용 CRUD 화면**에서 관리한다(`calendarIds` SystemSetting 폐기, relational 링크로 전환).

**비목표**
- 주간보고 도메인 자체 재설계(별도 과제). `defaultRecipients`는 편집 UI만 개선.
- 대금청구(`workflows.billing.config`) 화면 구현(여전히 relational placeholder 유지).
- 공휴일·내부 소스(`HOLIDAY`/`INTERNAL_LEAVE`/`WORKFLOW`/`MANUAL`) 관리 — PR-B는 `GOOGLE_CALENDAR`만.

## 3. PR 분할

| PR | 범위 |
| --- | --- |
| **PR-A** | 설정 페이지 IA 재편 + SMTP DB 배선 + 상태 진실화 + 편집기(string/number/list) + `calendarIds`→relational 링크 |
| **PR-B** | `/admin/settings/calendar-sources` — Google 캘린더 소스 CRUD 화면 |

각 PR은 spec→plan→impl→review-loop 사이클을 **독립 세션**으로 돌린다(session-per-merge). 본 문서는 두 PR 설계를 함께 담되, **PR-A를 상세**히, PR-B는 합의된 결정을 개요로 둔다(PR-A 머지 후 새 세션에서 plan 상세화).

PR-A의 `calendarIds`→relational 링크는 PR-B 화면이 아직 없어도 동작한다 — 기존 `workflows.billing.config`가 미구현 `/admin/settings/billing`을 링크하는 것과 동일 패턴.

## 4. 결정 (Decisions)

- **D1 — 연동 설정 진실원 = UI(DB), 단 SMTP 연결/인증 민감 필드는 env(보안).** 비민감 SMTP 필드(port·fromAddress)는 DB가 진실원이고 전송이 이를 읽는다(env fallback). 그러나 **연결/인증 민감 필드(host·user·secure·password)는 env에 유지**한다 — DB-편집 host에 전역 env password를 주입하면 비밀번호 유출 벡터가 생기기 때문(F4, §10). 상태 점검은 실제 동작 출처(env host+password, DB-or-env port/from)를 본다.
- **D2 — SMTP 연결/인증 정보(host·user·secure·password)는 env 전용.** 이들은 비암호 SystemSetting/감사 로그에 두지 않고 env 신뢰경계에 유지한다(F4 유출 벡터 차단). **DB로 편집 가능한 SMTP 필드 = port·fromAddress**(비민감)뿐. password는 상태 배지(env secret)만. host/user/secure는 UI에 편집 노출하지 않는다(서버 env로 관리; 읽기전용 표시는 후속 선택).
- **D3 — SMTP 설정 해석기는 kernel, 전송 config 타입은 lib에 둔다(경계 안전).** eslint boundaries상 `lib`는 `lib`만 import 가능하므로 메일 lib이 `@/kernel/settings`(타입 포함)를 import하면 boundary lint가 깨진다. 따라서 전송 config 타입 `MailTransportConfig`(host/port/secure/user/from)를 **메일 lib**에 정의하고, kernel의 `getSmtpConfig()`는 이 타입과 **구조적으로 호환되는 객체**를 반환한다(kernel→lib import는 허용되므로 kernel이 lib 타입을 채택해도 됨). `sendMail`은 lib 자신의 타입을 인자로 받으므로 **lib→kernel import가 발생하지 않는다**. 호출자(leave·workflows 모듈)가 `getSmtpConfig()`를 호출해 전달한다.
- **D10 — 전송 경로 SMTP 해석은 throw하지 않는다(무회귀 실효 보장).** `getSmtpConfig()`는 DB 값 읽기 실패·무효 파싱·settings 인프라 오류가 나도 **해당 필드를 env로 폴백**하고 경고 로그만 남긴다(절대 throw 안 함). SystemSetting 한 행이 깨져도 유효한 env SMTP로 메일이 계속 나간다 — D1 "무회귀"의 실효 보장. 깨진 행 자체는 설정 화면의 **항목별 INVALID 배지**(`listSettings`가 이미 부여)로 노출돼 신호가 사라지지 않는다. 두 mail 호출자는 `getSmtpConfig()`를 무조건 await하므로, 이 함수가 throw하면 env가 멀쩡해도 발송이 막히기 때문에 tolerant가 필수다.
- **D4 — 상단 "연동 상태" 요약 카드 제거 → 영역 카드 헤더 배지로 일원화.** 상태 계산을 한 경로로 모아 요약-본문 모순을 구조적으로 제거한다.
- **D5 — 상태 점검은 실제 동작 출처를 본다(전송과 동일 경로).** SMTP `configured` = `SMTP_PASSWORD`(env) 존재 AND `getSmtpConfig()`가 해석한 host 비어있지 않음 — 전송과 **같은 tolerant 해석기**를 써서 "메일이 실제로 나갈 수 있는가"와 일치(요약-본문 모순 재발 방지). SMTP는 throw하지 않으므로(D10) 그룹 배지에 `unknown`이 나오지 않고, 깨진 행은 항목별 INVALID 배지로 surface. Google `configured` = 서비스 계정 키(env) 존재 AND 활성 `GOOGLE_CALENDAR` 소스 ≥1개 — prisma count가 실패할 수 있어 **Google·문서 경로는 기존 `safe()`/`unknown` 3-state 유지**. 문서/템플릿 = LibreOffice 경로(env) 존재(현행 유지).
- **D6 — `integrations.google.calendarIds` 폐기 → relational 전환 + seed cutover(F5).** calendarIds를 relational 항목으로 바꾼다(`manageHref = /admin/settings/calendar-sources`, `permission = integrations.google:configure`). **중요(F5)**: `prisma/seed.ts`(117–157)가 `calendarIds`(+`calendarOwners`)를 읽어 `planGoogleSources`로 GOOGLE_CALENDAR 소스를 생성/일시정지(목록에 없는 소스 PAUSED)하므로, 그대로 두면 매 배포 `db:seed`가 CRUD로 관리되는 소스를 PAUSED시키는 데이터 드리프트가 난다("무해" 아님). 따라서 PR-A에서 **seed의 calIds/owners 기반 GOOGLE_CALENDAR 생성·일시정지 로직을 제거**한다(HOLIDAY 소스 seed는 유지). CalendarSource가 Google 소스의 단일 진실원이 되어 재-seed가 CRUD 관리 소스를 건드리지 못한다. orphaned SystemSetting row(calendarIds/calendarOwners)는 더 이상 아무도 읽지 않으므로 무해.
- **D7 — 표시 그룹은 `group` 필드로 세분화.** `category`(coarse)는 보존하되, 화면 렌더링은 신규 `group` + `groupOrder`로 한다. 그룹: 보안 → 메일(SMTP) → Google → 문서/템플릿 → 연차 알림 → 업무.
- **D8 — 편집기는 값 타입으로 선택.** `string`→텍스트 입력, `number`→숫자 입력, `boolean`→스위치(기존), `string[]`→리스트 편집기, 그 외(객체)→기존 JSON textarea 폴백. 서버 zod가 여전히 권위 검증.
- **D9 — Prisma 마이그레이션 없음.** PR-A는 카탈로그/서비스/UI 변경 + 신규 SystemSetting 키(row는 쓰기 시 생성). PR-B는 기존 `CalendarSource` 테이블 사용. 둘 다 표준 restart 배포(스키마 무변경).

## 5. PR-A 상세 설계

### 5.1 카탈로그 / IA (`src/kernel/settings/catalog.ts`, `registry.ts`, `service.ts`)

`SettingEntryBase`에 표시 그룹 필드 추가:

```ts
group: SettingGroup;     // "security" | "mail" | "google" | "documents" | "leave" | "workflows"
groupOrder: number;      // 그룹 내 표시 순서
```

`SettingsCatalogItem`에 `group`/`groupOrder` 전파. `listSettings`는 기존대로 항목을 반환하되 정렬 키를 `groupOrder`로 사용(또는 페이지가 group으로 버킷팅).

그룹 배정:

| group | 라벨 | 항목 |
| --- | --- | --- |
| security | 보안 | `secret.database`, `secret.auth` |
| mail | 메일 (SMTP) | `secret.smtp`(상태/env), `integrations.smtp.port`(DB), `integrations.smtp.fromAddress`(DB) |
| google | Google | `secret.google`(상태), `integrations.google.calendarIds`(relational) |
| documents | 문서 / 템플릿 | `secret.libreoffice`(상태) |
| leave | 연차 알림 | `leave.notifications.onRequest/onApprove/onReject` |
| workflows | 업무 | `workflows.weeklyReport.defaultRecipients`, `workflows.billing.config`(relational) |

**SMTP 카탈로그 변경(D2, F4)**:
- `integrations.smtp.host` systemSetting **제거**(env 전용 — host는 UI 편집 노출 안 함). orphaned DB row는 무해(getEntry undefined → 미표시·미기록·비쓰기). 현재 `integrations.smtp.host`를 읽는 곳은 status.ts뿐이며 이를 env 기반으로 재작성(§5.3)하므로 안전.
- `integrations.smtp.port`, `integrations.smtp.fromAddress` systemSetting **유지**(DB 편집, 전송이 읽음 — §5.2).
- `secure`/`user`는 **DB에 추가하지 않는다**(env 전용). (이전 안의 TLS 토글·사용자명 편집 필드 폐기.)

**전환**: `integrations.google.calendarIds`를 `kind: "relational"`로 변경(model 명시 불필요/생략, `manageHref: "/admin/settings/calendar-sources"`).

**seed cutover(D6, F5)** — `prisma/seed.ts`: HOLIDAY 소스 upsert는 유지하고, `calendarIds`/`calendarOwners`를 읽어 GOOGLE_CALENDAR 소스를 생성/일시정지하는 블록(`planGoogleSources` 호출 + create/update/PAUSED)을 **제거**한다. CalendarSource가 Google 소스 단일 진실원이 되어, 재-seed가 기존(수동/CRUD) GOOGLE_CALENDAR 소스를 건드리지 않는다. PR-B(CRUD) 전이라도 기존 소스 행은 그대로 보존된다(seed가 더 이상 손대지 않을 뿐).

### 5.2 SMTP DB 배선 (D1·D2·D3)

**전송 config 타입은 lib에 정의**(D3, 경계 안전) — `src/lib/integrations/mail/index.ts`:

```ts
export interface MailTransportConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
}
```
- 비밀번호는 이 타입에 없다 — `sendMail`이 `process.env.SMTP_PASSWORD`에서 직접 읽는다(D2, secret은 config로 흐르지 않음).

**kernel 해석기** — `src/kernel/settings/service.ts`에 추가, `reader.ts`에서 re-export(모듈은 `@/kernel/settings/reader`만 import 가능). 반환 타입은 lib의 `MailTransportConfig`를 채택한다(kernel→lib import 허용):

```ts
import type { MailTransportConfig } from "@/lib/integrations/mail";
export async function getSmtpConfig(): Promise<MailTransportConfig>;
//   host:   env SMTP_HOST || ""             ← env 전용(D2, F4)
//   user:   env SMTP_USER || ""             ← env 전용(D2, F4)
//   secure: env SMTP_SECURE === "true"      ← env 전용(D2, F4)
//   port:   DB port || Number(env SMTP_PORT) || 587          ← DB 편집(env fallback)
//   from:   DB fromAddress || env SMTP_FROM || env SMTP_USER || "noreply@uracle.co.kr"  ← DB 편집(env fallback)
```
- **민감 필드(host/user/secure)는 env에서만 읽는다**(D2). DB는 읽지 않으므로 유출 벡터·throw 없음.
- **폴백 규칙(D1)**: DB-편집 필드(port·from)는 DB 값이 비어있지 않으면 DB, 아니면 env.
- **tolerant(D10)**: DB-읽기 필드(port·from)만 개별 try/catch로 감싸 무효 파싱·읽기 실패 시 env로 폴백하고 `console.warn`만 남긴다. **`getSmtpConfig` 전체가 throw하지 않는다.** (port가 무효 row여도 env/default로 떨어지고 발송 진행.)

**lib 변경** — `src/lib/integrations/mail/index.ts`:
- `sendMail(msg: MailMessage, config?: MailTransportConfig)`로 시그니처 확장.
- `buildTransport(config?)`: config가 있으면 `host/port/secure/user`를 config에서, `pass`는 `process.env.SMTP_PASSWORD`(D2). config 없으면 **현행 env-only 동작 보존**(테스트는 `setMailTransportForTests`로 우회하므로 무영향). config.host가 비고 env SMTP_HOST도 없으면 기존처럼 throw("SMTP_HOST 미설정").
- `from`: `config?.from`가 있으면 사용, 없으면 기존 env 폴백 체인.
- lib은 kernel을 import하지 않는다 — `MailTransportConfig`는 자기 레이어 타입.

**호출자 변경** — `src/modules/leave/services/mail.ts`, `src/modules/workflows/services/mail.ts`:
- `const cfg = await getSmtpConfig(); await sendMail(msg, cfg);` (모듈→kernel·모듈→lib 모두 허용). `getSmtpConfig`는 throw하지 않으므로(D10) 이 await가 유효한 env 발송을 막지 않는다.

### 5.3 상태 진실화 (D4·D5) — `src/modules/integrations/status.ts`, `src/app/(app)/admin/settings/page.tsx`

- `smtpConfigured()`: `getSmtpConfig()`(tolerant, throw 없음) 사용 → `secretOk(SMTP_PASSWORD)` AND `cfg.host.length > 0`. host는 env(D2)에서 오므로 "env에 SMTP_HOST+password가 있으면 정상" = 실제 발송 가능 여부와 일치(원래 모순 해소). SMTP는 throw하지 않으므로 `safe()` 래핑 불필요 — `unknown` 미발생.
  - **`configured` 계약(명시)**: 정적으로 검증 가능한 **필수 설정의 존재**만 본다 — secret(env password) + host(env) 비어있지 않음. port·from은 tolerant 해석기가 항상 유효값 보장하므로 추가 게이트 불필요. host·user·password가 모두 env 신뢰경계에 있어(D2) DB-편집으로 인한 자격증명 불일치는 발생할 수 없다(F3의 핵심 우려가 F4 조치로 함께 완화). 다만 배지는 "**메일이 반드시 성공한다**"는 보장이 **아니다** — SMTP 서버 도달성·인증 성공은 라이브 핸드셰이크 없이는 알 수 없다. 실제 발송 확정은 후속 "연결 테스트" 액션(§10)으로 분리. 잘못 저장된 port/from 행은 항목별 INVALID 배지로 노출.
- `googleConfigured()`: `secretOk(GOOGLE_APPLICATION_CREDENTIALS)` AND 활성 `GOOGLE_CALENDAR` 소스 ≥1.
  - 카운트는 `prisma.calendarSource.count({ where: { kind: "GOOGLE_CALENDAR", syncStatus: "ACTIVE" } })` — status.ts(module)는 `@/lib/prisma`(lib) import 허용. (calendar 모듈 import는 경계 위반이라 직접 count.)
- `templatesConfigured()`: 현행 유지.
- **페이지**: 상단 "연동 상태" 카드 제거(D4). 각 영역 카드 헤더에 해당 그룹의 상태 배지를 렌더(mail→smtp, google→google, documents→templates 상태 매핑). 상태 없는 그룹(security 항목은 항목별 배지, leave/workflows는 배지 없음)은 헤더 배지 생략.
  - Google 영역의 relational 행에 "N개 연결됨" 표시(활성 소스 카운트). `getIntegrationStatuses`가 google 카운트를 함께 반환하거나 페이지가 별도 조회 — plan에서 확정(중복 조회 최소화).

### 5.4 편집기 (D8) — `src/app/(app)/admin/settings/settings-editor.tsx`

`SettingEditor`가 `initialValue` 타입으로 분기:
- `Array.isArray` → **`ListSettingEditor`**(신규): 문자열 배열. 행별 표시 + 삭제(✕), 하단 입력+추가, Enter 추가, 기본 형식 검증(이메일은 정규식). 저장은 전체 배열을 기존 PUT으로 전송(낙관적 토큰 패턴 유지). 서버 zod(`array(email)`)가 권위.
- `typeof === "boolean"` → 기존 `BooleanSettingEditor`(스위치).
- `typeof === "number"` → **`NumberSettingEditor`**(신규): 숫자 입력 + 저장.
- `typeof === "string"` → **`StringSettingEditor`**(신규): 텍스트 입력 + 저장. (현행 JSON textarea의 `""` 노출 제거.)
- 그 외(객체) → 기존 `JsonSettingEditor` 폴백.

신규 편집기는 모두 기존 `putSetting` 판별 유니온(ok/rejected/refetch)·토큰 동시성 패턴을 재사용한다. `env` secret 항목은 편집기 없이 상태 배지 + "env" 태그만 표시.

## 6. PR-B 개요 — Google 캘린더 소스 CRUD (`/admin/settings/calendar-sources`)

PR-A 머지 후 새 세션에서 상세 plan. 합의된 결정:
- **범위**: `kind = GOOGLE_CALENDAR` 소스만 목록/추가/수정/삭제(내부 소스 제외).
- **권한**: 조회 `integrations.google:view`, 변경 `integrations.google:configure`(기존 권한 재사용 — access catalog에서 존재 확인).
- **편집 필드**: `name`, `externalId`(Google 캘린더 ID/이메일), `color`, `visibility`, `ownerUserId`(선택 — 공유=null/개인), `cacheTtlSeconds`, `syncStatus`(ACTIVE/PAUSED). `key`는 자동 생성.
- **검증(선택)**: Google 클라이언트로 도달성 테스트(`listEvents`) 버튼 — nice-to-have.
- **UI**: 기존 admin CRUD(사용자/팀 관리) 패턴·공용 프리미티브(Table·Modal·States·PageHeader) 재사용.
- 마이그레이션 없음(기존 `CalendarSource` 테이블).

## 7. 테스트

- **kernel**: `getSmtpConfig` — host/user/secure는 **env에서만** 해석(DB row가 있어도 무시), port·from은 DB 우선·env 폴백·빈 값 처리.
- **lib**: `sendMail(msg, config)` — config 주입 시 transport 인자(host/port/secure/user from config, pass=env), config 미주입 시 현행 env 동작 보존(`setMailTransportForTests` fake로 인자 검증).
- **kernel(getSmtpConfig tolerant, D10)**: ① **무효 DB port row + 유효 env SMTP → throw 없이 env/default로 해석, 발송 가능**(무회귀 회귀 테스트), ② settings 읽기 실패(인프라 오류) + env present → env config 반환·throw 없음, ③ DB(port/from) 채움 시 DB 우선·빈 값 시 env 폴백 필드별 검증.
- **integrations 상태**: `smtpConfigured` — env host+secret 있음→정상, env host 없음→설정 필요, **secret(password) 없음→설정 필요**, **무효 DB port여도 env host+secret 있으면 정상**. `googleConfigured`(소스 카운트·secret 조합), Google·문서 `unknown` 환원 회귀.
- **catalog/service**: `integrations.smtp.host` 제거·`secure`/`user` 미추가, group/groupOrder 전파, `calendarIds` relational 전환.
- **seed cutover(F5)**: `db:seed` 재실행이 기존 GOOGLE_CALENDAR 소스(수동/CRUD 추가, calendarIds 목록에 없음)를 PAUSED로 바꾸지 **않음**을 검증(드리프트 회귀). HOLIDAY 소스 upsert는 유지됨.
- **UI(편집기)**: list 추가/삭제/형식검증, string/number 편집기 저장·롤백(rejected)·refetch 경로, boolean 회귀.
- 기존 스위트 그린 유지(현재 1380 통과 기준).

## 8. 배포 / 마이그레이션

- **Prisma 마이그레이션 없음**(D9) → 표준 restart 배포(`build` → `pm2 restart`). 단 **seed 코드가 바뀌므로**(F5 cutover) 배포 시 `db:seed`를 1회 실행해 변경된 seed가 적용되게 한다(권한 catalog 변경은 없음).
- 서버 env(`SMTP_HOST`/`SMTP_USER`/`SMTP_SECURE`/`SMTP_PASSWORD` 등)는 그대로 유지 — 민감 연결/인증 필드의 진실원이자(D2), port/from DB 미입력 시 폴백원. DB 미입력 상태에서도 현행 메일 발송 무회귀.
- smoke: 인증 후 `/admin/settings` 렌더(영역 카드·상태 배지), SMTP 저장→메일 발송 1건, advisory 라우트 회귀(stale-build P2010 주의 — 인증 경로 포함).

## 9. 영향 범위 / 리스크

- **메일 전송 경로 변경**(working path) — D1 폴백 + D10 tolerant 해석기로 회귀 위험 차단(깨진 DB 행이 env 발송을 막지 못함). 가장 큰 검증 포인트: config 미주입(테스트)·DB 빈 값(폴백)·DB 채움(신규)·**DB 무효 행+env 유효(throw 없이 발송)** 4경우.
- `sendMail` 시그니처 확장 — 호출자 2곳(leave·workflows) 동시 갱신 필수.
- 상태 점검에 prisma count 추가(google) — feed 성능엔 영향 없음(설정 화면 1회 조회).
- 표현계층(IA·편집기) 변경은 도메인 불변식·동시성 패턴 무영향(설정 쓰기 토큰 패턴·audit 유지).
- **보안**: SMTP 연결/인증 민감 필드(host·user·secure·password)를 env에 유지(D2, F4) — DB-편집 가능한 SMTP 표면은 비민감 port·fromAddress로 한정. 비밀번호 유출 벡터 없음.
- **seed 변경**(F5 cutover): Google 소스 관리 책임이 seed→CalendarSource(CRUD)로 이동. PR-A 배포 시 seed 1회 실행 필요(§8).

## 10. 적대검증 판정(ledger)

spec 단계 적대검증 결과와 판정. blocking은 모두 닫음(미판정 0).

| # | finding | sev | disposition | 근거 / 연결 |
| --- | --- | --- | --- | --- |
| F1 | 메일 lib이 kernel 타입을 import → boundary 위반 | high | **FIXED** | D3·§5.2 — 전송 config 타입 `MailTransportConfig`를 lib에 정의, kernel `getSmtpConfig`가 채택(kernel→lib 허용). lib→kernel import 없음. |
| F2 | 전송 경로 `getSmtpConfig` throw가 env 유효해도 발송 차단(D1 무회귀 모순) | high | **FIXED** | D10·§5.2 — tolerant 해석기(필드별 env 폴백·throw 금지) + §7 무회귀 테스트. |
| F3 | SMTP 상태가 port/from/auth 일치 등 전송 전제를 무시 → "정상"인데 발송 실패 가능 | medium | **ACCEPTED** | port·from은 tolerant 해석기가 유효값 보장. host·user·password가 모두 env(D2)라 DB-편집發 자격증명 불일치는 불가능(F4 조치로 핵심 우려 완화). 서버 도달성·인증 성공은 **라이브 핸드셰이크 없이 정적 검증 불가** — 배지 계약을 "필수 설정 존재"로 명시(§5.3). **보완 단계(후속)**: SMTP "연결 테스트" 액션. |
| F4 | DB-편집 host에 전역 env password 주입 → 임의 host로 비밀번호 유출 | high | **FIXED(설계 변경)** | 사용자 결정(option 1): host·user·secure·password를 **env 전용**으로 유지(D1·D2 개정). DB 편집은 비민감 port·fromAddress뿐. host가 UI 통제 밖이라 유출 벡터 제거. §5.1 catalog에서 `integrations.smtp.host` 제거, `secure`/`user` 미추가. |
| F5 | 폐기 예정 `calendarIds`를 seed가 계속 읽어 CRUD 관리 소스를 PAUSED(데이터 드리프트) | high | **FIXED** | D6·§5.1 — PR-A에서 seed의 calIds/owners 기반 GOOGLE_CALENDAR 생성·일시정지 제거(HOLIDAY 유지). CalendarSource 단일 진실원. §7 재-seed 드리프트 회귀 테스트. |

**후속(follow-up)**: SMTP/Google 연결 테스트(라이브 검증) 액션은 본 변경 범위 밖. PR-B(또는 별도 과제)에서 도입 검토.
