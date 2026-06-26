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
| **PR-A** | 설정 페이지 IA 재편 + SMTP 상태 진실화·port/from DB 배선 + 편집기(string/number/list) + 나열형(calendarIds·defaultRecipients) 리스트 편집기. **Google 소스 관리는 손대지 않음**(calendarIds는 기존 systemSetting 그대로 유지). |
| **PR-B** | `/admin/settings/calendar-sources` Google 캘린더 소스 CRUD + **calendarIds→relational 전환 + seed cutover(create-only) + googleConfigured→소스 카운트**. Google 전환 전체를 PR-B에서 atomic하게. |

각 PR은 spec→plan→impl→review-loop 사이클을 **독립 세션**으로 돌린다(session-per-merge). 본 문서는 두 PR 설계를 함께 담되, **PR-A를 상세**히, PR-B는 합의된 결정을 개요로 둔다(PR-A 머지 후 새 세션에서 plan 상세화).

**PR 경계 결정(F10)**: calendarIds의 relational 전환·seed cutover를 PR-A에 두면 CRUD(PR-B) 도입 전까지 Google 소스 관리 UI가 사라지는 공백이 생긴다(F6·F8·F10 동일 뿌리). 따라서 **Google 관련 변경 일체를 PR-B로 이동**한다. PR-A는 calendarIds를 systemSetting(string[])로 그대로 두고 리스트 편집기 UI만 입힌다(동작·seed 무변경) — 공백·드리프트(F5)가 PR-A에서 발생하지 않는다.

**PR-A는 `calendarIds`에 relational 링크/`manageHref`를 두지 않는다**(F13) — calendarIds는 `systemSetting`(string[]) + 리스트 편집기로만 유지하고, relational 전환·`manageHref=/admin/settings/calendar-sources`·`googleConfigured` 카운트 변경은 CRUD가 함께 도입되는 **PR-B에서만** 한다. (relational이 미구현 화면을 가리켜도 되는 `workflows.billing.config` 패턴은 PR-B의 CRUD가 동시 도입되므로 PR-A에서 차용하지 않는다.)

## 4. 결정 (Decisions)

- **D1 — 연동 설정 진실원 = UI(DB), 단 SMTP 연결/인증 민감 필드는 env(보안).** 비민감 SMTP 필드(port·fromAddress)는 DB가 진실원이고 전송이 이를 읽는다(env fallback). 그러나 **연결/인증 민감 필드(host·user·secure·password)는 env에 유지**한다 — DB-편집 host에 전역 env password를 주입하면 비밀번호 유출 벡터가 생기기 때문(F4, §10). 상태 점검은 실제 동작 출처(env host+password, DB-or-env port/from)를 본다.
- **D2 — SMTP 연결/인증 정보(host·user·secure·password)는 env 전용.** 이들은 비암호 SystemSetting/감사 로그에 두지 않고 env 신뢰경계에 유지한다(F4 유출 벡터 차단). **DB로 편집 가능한 SMTP 필드 = port·fromAddress**(비민감)뿐. password는 상태 배지(env secret)만. host/user/secure는 UI에 편집 노출하지 않는다(서버 env로 관리; 읽기전용 표시는 후속 선택).
- **D3 — SMTP 설정 해석기는 kernel, 전송 config 타입은 lib에 둔다(경계 안전).** eslint boundaries상 `lib`는 `lib`만 import 가능하므로 메일 lib이 `@/kernel/settings`(타입 포함)를 import하면 boundary lint가 깨진다. 따라서 전송 config 타입 `MailTransportConfig`(host/port/secure/user/from)를 **메일 lib**에 정의하고, kernel의 `getSmtpConfig()`는 이 타입과 **구조적으로 호환되는 객체**를 반환한다(kernel→lib import는 허용되므로 kernel이 lib 타입을 채택해도 됨). `sendMail`은 lib 자신의 타입을 인자로 받으므로 **lib→kernel import가 발생하지 않는다**. 호출자(leave·workflows 모듈)가 `getSmtpConfig()`를 호출해 전달한다.
- **D10 — 전송 경로 SMTP 해석은 throw하지 않는다(무회귀 실효 보장).** `getSmtpConfig()`는 DB 값 읽기 실패·무효 파싱·settings 인프라 오류가 나도 **해당 필드를 env로 폴백**하고 경고 로그만 남긴다(절대 throw 안 함). SystemSetting 한 행이 깨져도 유효한 env SMTP로 메일이 계속 나간다 — D1 "무회귀"의 실효 보장. 깨진 행 자체는 설정 화면의 **항목별 INVALID 배지**(`listSettings`가 이미 부여)로 노출돼 신호가 사라지지 않는다. 두 mail 호출자는 `getSmtpConfig()`를 무조건 await하므로, 이 함수가 throw하면 env가 멀쩡해도 발송이 막히기 때문에 tolerant가 필수다.
- **D4 — 상단 "연동 상태" 요약 카드 제거 → 영역 카드 헤더 배지로 일원화.** 상태 계산을 한 경로로 모아 요약-본문 모순을 구조적으로 제거한다.
- **D5 — 상태 점검은 실제 동작 출처를 본다(전송과 동일 경로·auth 분기).** SMTP `configured` = host(env) 비어있지 않음 AND **인증 정합성**(`SMTP_USER` 없으면 무인증 릴레이로 OK, `SMTP_USER` 있으면 `SMTP_PASSWORD`도 존재) — 전송의 auth 분기(`SMTP_USER ? {user,pass} : undefined`, F9)와 정확히 일치시켜 false-negative 재발 방지. 전송과 같은 tolerant 해석기를 쓰고, SMTP는 throw하지 않으므로(D10) 그룹 배지에 `unknown`이 나오지 않고, 깨진 행은 항목별 INVALID 배지로 surface. Google `configured` = 서비스 계정 키(env) 존재 AND 활성 `GOOGLE_CALENDAR` 소스 ≥1개 — prisma count가 실패할 수 있어 **Google·문서 경로는 기존 `safe()`/`unknown` 3-state 유지**. 문서/템플릿 = LibreOffice 경로(env) 존재(현행 유지).
- **D6 — Google 전환(calendarIds→relational + seed cutover)은 전부 PR-B 범위(F10).** PR-A는 `integrations.google.calendarIds`를 기존 `systemSetting`(string[]) **그대로 유지**하고 리스트 편집기 UI만 입힌다(동작·seed 무변경). relational 전환·seed cutover·googleConfigured 카운트 변경은 CRUD가 함께 도입되는 **PR-B에서 atomic하게** 수행한다 — PR-A에 두면 CRUD 전까지 Google 소스 관리 공백(F6·F8·F10)·재-seed 드리프트(F5)가 생기기 때문. PR-A에서 `googleConfigured`(secret + calendarIds 비어있지 않음)·seed는 **현행 유지**.
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
| google | Google | `secret.google`(상태), `integrations.google.calendarIds`(systemSetting, **리스트 편집기** — PR-A에서 relational 전환 안 함) |
| documents | 문서 / 템플릿 | `secret.libreoffice`(상태) |
| leave | 연차 알림 | `leave.notifications.onRequest/onApprove/onReject` |
| workflows | 업무 | `workflows.weeklyReport.defaultRecipients`, `workflows.billing.config`(relational) |

**SMTP 카탈로그 변경(D2, F4)**:
- `integrations.smtp.host` systemSetting **제거**(env 전용 — host는 UI 편집 노출 안 함). orphaned DB row는 무해(getEntry undefined → 미표시·미기록·비쓰기). 현재 `integrations.smtp.host`를 읽는 곳은 status.ts뿐이며 이를 env 기반으로 재작성(§5.3)하므로 안전.
- `integrations.smtp.port`, `integrations.smtp.fromAddress` systemSetting **유지**(DB 편집, 전송이 읽음 — §5.2).
- `secure`/`user`는 **DB에 추가하지 않는다**(env 전용). (이전 안의 TLS 토글·사용자명 편집 필드 폐기.)

**Google(calendarIds)**: PR-A에서는 `kind` 변경·seed 변경 **없음**. `integrations.google.calendarIds`는 `systemSetting`(string[]) 그대로이며 §5.4 리스트 편집기를 적용받는다. relational 전환·seed cutover는 PR-B(§6).

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
- **DB-편집 필드(port·from)는 `readRaw`(원시 행)로 읽는다, `getSetting` 금지(F7).** `getSetting`은 행이 없으면 **카탈로그 default를 반환**한다 — `integrations.smtp.port` default가 587이라, DB 행이 없는데 `getSetting`을 쓰면 env `SMTP_PORT`(예: 465/2525)를 무시하고 587로 덮어 비-587 env가 조용히 망가진다. 따라서 **행 부재(`readRaw`=null)** → env(`SMTP_PORT`)→587, **행 존재** → 파싱(유효=DB, 무효=env로 폴백). (`from`은 default가 `""`라 동일 위험은 없지만 일관성·빈값 구분 위해 같은 readRaw 처리.)
- **폴백 규칙(D1)**: DB 행이 있고 유효하면 DB, 행이 없거나 비었거나 무효면 env.
- **tolerant(D10)**: DB-읽기 필드(port·from)만 개별 try/catch로 감싸 무효 파싱·읽기 실패 시 env로 폴백하고 `console.warn`만 남긴다. **`getSmtpConfig` 전체가 throw하지 않는다.**

**lib 변경** — `src/lib/integrations/mail/index.ts`:
- `sendMail(msg: MailMessage, config?: MailTransportConfig)`로 시그니처 확장.
- `buildTransport(config?)`: config가 있으면 `host/port/secure/user`를 config에서, `pass`는 `process.env.SMTP_PASSWORD`(D2). config 없으면 **현행 env-only 동작 보존**(테스트는 `setMailTransportForTests`로 우회하므로 무영향). config.host가 비고 env SMTP_HOST도 없으면 기존처럼 throw("SMTP_HOST 미설정").
- `from`: `config?.from`가 있으면 사용, 없으면 기존 env 폴백 체인.
- lib은 kernel을 import하지 않는다 — `MailTransportConfig`는 자기 레이어 타입.

**호출자 변경** — `src/modules/leave/services/mail.ts`, `src/modules/workflows/services/mail.ts`:
- `const cfg = await getSmtpConfig(); await sendMail(msg, cfg);` (모듈→kernel·모듈→lib 모두 허용). `getSmtpConfig`는 throw하지 않으므로(D10) 이 await가 유효한 env 발송을 막지 않는다.

### 5.3 상태 진실화 (D4·D5) — `src/modules/integrations/status.ts`, `src/app/(app)/admin/settings/page.tsx`

- `smtpConfigured()`(F9, 전송 auth 분기와 일치): `cfg.host.length > 0` AND **인증 정합성** — `SMTP_USER` 미설정이면 무인증 릴레이로 발송되므로 `host`만으로 OK, `SMTP_USER` 설정 시에만 `SMTP_PASSWORD`(env) 존재를 요구. 즉 `host && (!SMTP_USER || (SMTP_USER && SMTP_PASSWORD))`. host는 env(D2)에서 오므로 "env에 발송 가능한 SMTP가 있으면 정상" = 실제 발송 가능 여부와 일치(원래 모순·F9 false-negative 모두 해소). SMTP는 throw하지 않으므로 `safe()` 래핑 불필요 — `unknown` 미발생.
  - **`configured` 계약(명시)**: 정적으로 검증 가능한 **필수 설정의 존재·정합성**만 본다 — host(env) + 위 인증 정합성. port·from은 tolerant 해석기가 항상 유효값 보장하므로 추가 게이트 불필요. host·user·password가 모두 env 신뢰경계에 있어(D2) DB-편집發 자격증명 불일치는 불가능(F3 우려가 F4로 완화). 다만 배지는 "**메일이 반드시 성공한다**"는 보장이 **아니다** — 서버 도달성·인증 성공은 라이브 핸드셰이크 없이는 알 수 없다. 실제 발송 확정은 후속 "연결 테스트" 액션(§10)으로 분리. 잘못 저장된 port/from 행은 항목별 INVALID 배지로 노출.
- **`secret.smtp`(비밀번호) 항목 행 상태도 auth 분기 따름(F12)**: 무인증 릴레이(`SMTP_USER` 미설정)면 비밀번호는 불필요하므로 행을 "설정 필요"로 표시하지 않는다(예: "인증 미사용"/중립 표시). `SMTP_USER` 설정 시에만 `SMTP_PASSWORD` 존재로 정상/설정 필요 판정. → 그룹 헤더(정상)와 항목 행이 어긋나지 않게(원래 모순 재발 방지). 구현은 `secret.smtp` 항목 상태를 단순 env-var 존재가 아니라 auth-mode 계산으로 산출.
- `googleConfigured()`: **PR-A 현행 유지** — `secretOk(GOOGLE_APPLICATION_CREDENTIALS)` AND `calendarIds` 비어있지 않음. (소스 카운트 기반 판정은 Google 전환과 함께 PR-B로 이동, §6.)
- `templatesConfigured()`: 현행 유지.
- **페이지**: 상단 "연동 상태" 카드 제거(D4). 각 영역 카드 헤더에 해당 그룹의 상태 배지를 렌더(mail→smtp, google→google, documents→templates 상태 매핑). 상태 없는 그룹(security 항목은 항목별 배지, leave/workflows는 배지 없음)은 헤더 배지 생략. (Google 영역은 calendarIds 리스트 편집기를 그대로 노출 — relational "N개 연결됨" 행은 PR-B.)

### 5.4 편집기 (D8) — `src/app/(app)/admin/settings/settings-editor.tsx`

`SettingEditor`가 `initialValue` 타입으로 분기:
- `Array.isArray` → **`ListSettingEditor`**(신규): 문자열 배열. 행별 표시 + 삭제(✕), 하단 입력+추가, Enter 추가, 기본 형식 검증(이메일은 정규식). 저장은 전체 배열을 기존 PUT으로 전송(낙관적 토큰 패턴 유지). 서버 zod(`array(email)`)가 권위.
- `typeof === "boolean"` → 기존 `BooleanSettingEditor`(스위치).
- `typeof === "number"` → **`NumberSettingEditor`**(신규): 숫자 입력 + 저장.
- `typeof === "string"` → **`StringSettingEditor`**(신규): 텍스트 입력 + 저장. (현행 JSON textarea의 `""` 노출 제거.)
- 그 외(객체) → 기존 `JsonSettingEditor` 폴백.

신규 편집기는 모두 기존 `putSetting` 판별 유니온(ok/rejected/refetch)·토큰 동시성 패턴을 재사용한다. `env` secret 항목은 편집기 없이 상태 배지 + "env" 태그만 표시.

## 6. PR-B 개요 — Google 캘린더 소스 CRUD (`/admin/settings/calendar-sources`)

PR-A 머지 후 새 세션에서 상세 plan(자체 spec→review-loop). 합의된 결정:
- **범위**: `kind = GOOGLE_CALENDAR` 소스만 목록/추가/수정/삭제(내부 소스 제외). **+ Google 전환 일체**(F10): `integrations.google.calendarIds`→relational 전환(`manageHref=/admin/settings/calendar-sources`), seed cutover, `googleConfigured`→활성 소스 카운트 — 모두 PR-B에서 CRUD와 함께 atomic하게.
- **seed cutover(create-only, F5·F6·F8)**: `prisma/seed.ts`의 `calendarIds`/`calendarOwners` 기반 GOOGLE_CALENDAR 처리를 **create-only**로 — 없는 calId만 생성(ACTIVE), 기존 행(어떤 syncStatus든) 무수정·비재활성화(의도적/CRUD pause 보호). HOLIDAY upsert 유지. 이로써 재-seed가 CRUD 관리 소스를 건드리지 않음. calId 완전 폐기는 추가 follow-up.
- **권한**: 조회 `integrations.google:view`, 변경 `integrations.google:configure`(기존 권한 재사용 — access catalog에서 존재 확인).
- **externalId PII 경계(F11, 필수)**: `CalendarSource.externalId`는 Google 캘린더 ID(개인 이메일일 수 있음)로 기존 설계상 **server-only**(feed엔 HMAC opaque key만 노출). 따라서 **목록/조회(view 권한)에는 name·상태·opaque key·카운트만** 노출하고, **externalId 표시·편집은 `configure` 권한**에서만. view-only 사용자에게 externalId가 응답에 절대 포함되지 않음을 테스트로 보장.
- **편집 필드(configure)**: `name`, `externalId`, `color`, `visibility`, `ownerUserId`(선택 — 공유=null/개인), `cacheTtlSeconds`, `syncStatus`(ACTIVE/PAUSED). `key`는 자동 생성(externalId의 HMAC, feed 누출 방지).
- **검증(선택)**: Google 클라이언트로 도달성 테스트(`listEvents`) 버튼 — nice-to-have.
- **UI**: 기존 admin CRUD(사용자/팀 관리) 패턴·공용 프리미티브(Table·Modal·States·PageHeader) 재사용.
- 마이그레이션 없음(기존 `CalendarSource` 테이블).

## 7. 테스트

- **kernel**: `getSmtpConfig` — host/user/secure는 **env에서만** 해석(DB row가 있어도 무시), port·from은 DB 우선·env 폴백·빈 값 처리.
- **lib**: `sendMail(msg, config)` — config 주입 시 transport 인자(host/port/secure/user from config, pass=env), config 미주입 시 현행 env 동작 보존(`setMailTransportForTests` fake로 인자 검증).
- **kernel(getSmtpConfig tolerant, D10)**: ① **무효 DB port row + 유효 env SMTP → throw 없이 env/default로 해석, 발송 가능**(무회귀), ② settings 읽기 실패(인프라 오류) + env present → env config 반환·throw 없음, ③ DB(port/from) 채움 시 DB 우선·빈 값 시 env 폴백 필드별 검증.
- **kernel(F7 port 회귀)**: **DB port 행 없음 + `SMTP_PORT=465`(≠587) → 465로 해석**(587 default가 env를 가리지 않음). `readRaw` 경로 검증.
- **integrations 상태**: `smtpConfigured`(F9 auth 분기) — ① host+`SMTP_USER`+`SMTP_PASSWORD` 있음→정상, ② host 있고 `SMTP_USER` **없음**(무인증 릴레이)→**정상**, ③ host 있고 `SMTP_USER` 있는데 `SMTP_PASSWORD` 없음→설정 필요, ④ host 없음→설정 필요, ⑤ 무효 DB port여도 host 조건 충족 시 정상. `googleConfigured`(현행: secret+calendarIds), 문서 `unknown` 환원 회귀.
- **secret.smtp 행 상태(F12)**: `SMTP_USER` 없음→행이 "설정 필요"로 안 뜸(중립), `SMTP_USER` 있고 password 없음→설정 필요. 그룹 헤더와 항목 행 일관성 검증.
- **catalog/service**: `integrations.smtp.host` 제거·`secure`/`user` 미추가, group/groupOrder 전파, **`calendarIds`는 systemSetting 유지(relational 전환 안 함)**.
- **UI(편집기)**: list 추가/삭제/형식검증(calendarIds·defaultRecipients), string/number 편집기 저장·롤백(rejected)·refetch 경로, boolean 회귀.
- 기존 스위트 그린 유지(현재 1380 통과 기준).

## 8. 배포 / 마이그레이션

- **Prisma 마이그레이션 없음 + seed 무변경**(D9, PR-A) → 표준 restart 배포(`build` → `pm2 restart`). PR-A는 seed·권한 catalog를 바꾸지 않으므로 `db:seed` 필수 아님(신규 SystemSetting 키 secure/user 미추가, host 제거는 카탈로그에서만). (seed cutover는 PR-B에서 `db:seed` 실행 동반.)
- 서버 env(`SMTP_HOST`/`SMTP_USER`/`SMTP_SECURE`/`SMTP_PASSWORD` 등)는 그대로 유지 — 민감 연결/인증 필드의 진실원이자(D2), port/from DB 미입력 시 폴백원. DB 미입력 상태에서도 현행 메일 발송 무회귀.
- smoke: 인증 후 `/admin/settings` 렌더(영역 카드·상태 배지), SMTP 저장(port/from)→메일 발송 1건, advisory 라우트 회귀(stale-build P2010 주의 — 인증 경로 포함).

## 9. 영향 범위 / 리스크

- **메일 전송 경로 변경**(working path) — D1 폴백 + D10 tolerant 해석기로 회귀 위험 차단(깨진 DB 행이 env 발송을 막지 못함). 가장 큰 검증 포인트: config 미주입(테스트)·DB 빈 값(폴백)·DB 채움(신규)·**DB 무효 행+env 유효(throw 없이 발송)** 4경우.
- `sendMail` 시그니처 확장 — 호출자 2곳(leave·workflows) 동시 갱신 필수.
- 표현계층(IA·편집기) 변경은 도메인 불변식·동시성 패턴 무영향(설정 쓰기 토큰 패턴·audit 유지).
- **보안**: SMTP 연결/인증 민감 필드(host·user·secure·password)를 env에 유지(D2, F4) — DB-편집 가능한 SMTP 표면은 비민감 port·fromAddress로 한정. 비밀번호 유출 벡터 없음.
- **Google·seed 무변경(PR-A)**: calendarIds·seed·CalendarSource는 PR-A에서 손대지 않음 — Google 관리 공백(F6/F8/F10)·재-seed 드리프트(F5)가 PR-A에서 발생하지 않음. Google 전환은 CRUD와 함께 PR-B에서 atomic(공백 없음).

## 10. 적대검증 판정(ledger)

spec 단계 적대검증 결과와 판정. blocking은 모두 닫음(미판정 0).

| # | finding | sev | disposition | 근거 / 연결 |
| --- | --- | --- | --- | --- |
| F1 | 메일 lib이 kernel 타입을 import → boundary 위반 | high | **FIXED** | D3·§5.2 — 전송 config 타입 `MailTransportConfig`를 lib에 정의, kernel `getSmtpConfig`가 채택(kernel→lib 허용). lib→kernel import 없음. |
| F2 | 전송 경로 `getSmtpConfig` throw가 env 유효해도 발송 차단(D1 무회귀 모순) | high | **FIXED** | D10·§5.2 — tolerant 해석기(필드별 env 폴백·throw 금지) + §7 무회귀 테스트. |
| F3 | SMTP 상태가 port/from/auth 일치 등 전송 전제를 무시 → "정상"인데 발송 실패 가능 | medium | **ACCEPTED** | port·from은 tolerant 해석기가 유효값 보장. host·user·password가 모두 env(D2)라 DB-편집發 자격증명 불일치는 불가능(F4 조치로 핵심 우려 완화). 서버 도달성·인증 성공은 **라이브 핸드셰이크 없이 정적 검증 불가** — 배지 계약을 "필수 설정 존재"로 명시(§5.3). **보완 단계(후속)**: SMTP "연결 테스트" 액션. |
| F4 | DB-편집 host에 전역 env password 주입 → 임의 host로 비밀번호 유출 | high | **FIXED(설계 변경)** | 사용자 결정(option 1): host·user·secure·password를 **env 전용**으로 유지(D1·D2 개정). DB 편집은 비민감 port·fromAddress뿐. host가 UI 통제 밖이라 유출 벡터 제거. §5.1 catalog에서 `integrations.smtp.host` 제거, `secure`/`user` 미추가. |
| F5 | 폐기 예정 `calendarIds`를 seed가 계속 읽어 CRUD 관리 소스를 PAUSED(데이터 드리프트) | high | **→ PR-B**(PR-A OUT_OF_SCOPE) | F10 재조정으로 PR-A는 seed·calendarIds 무변경 → PR-A에서 드리프트 발생 안 함. seed cutover(create-only)는 PR-B §6에 기록. |
| F6 | seed 블록 제거 시 CRUD 도입 전 소스 생성·복구 경로 소실 | high | **→ PR-B**(PR-A OUT_OF_SCOPE) | 동상. Google 관리가 PR-A에서 그대로 유지되므로 공백 없음. PR-B에서 CRUD와 함께 처리(§6). |
| F7 | `getSmtpConfig` port가 `getSetting`(행 부재 시 default 587)을 쓰면 비-587 env(465 등) 무시·발송 실패 | high | **FIXED** | §5.2 — port·from은 `readRaw`로 행 부재/빈값/무효를 default와 구분, 부재면 env. §7 `SMTP_PORT=465`+행없음→465 회귀 테스트. |
| F8 | create-only 백필이 listed-but-PAUSED 소스를 재활성화 못 함(복구 보장 과장) | high | **→ PR-B**(PR-A OUT_OF_SCOPE) | seed 백필 자체가 PR-B로 이동. 복구 계약은 PR-B에서 정밀화(§6). |
| F9 | SMTP 상태가 무인증 릴레이(`SMTP_USER` 없음) 발송을 "설정 필요"로 오판(false-negative 재발) | medium | **FIXED** | D5·§5.3 — 상태를 전송 auth 분기와 일치: `host && (!SMTP_USER \|\| (SMTP_USER && SMTP_PASSWORD))`. §7 무인증 릴레이→정상, user-without-password→설정 필요 테스트. |
| F10 | PR-A의 calendarIds relational 전환이 CRUD(PR-B) 전 Google 관리 공백 유발(F6·F8 동일 뿌리, 3회 재발) | high | **FIXED(PR 재조정)** | 사용자 결정: Google 전환(relational+seed cutover+카운트)을 **전부 PR-B로 이동**(§3·D6·§6). PR-A는 calendarIds를 systemSetting 리스트 편집기로 유지(동작·seed 무변경) → 공백·드리프트(F5/F6/F8) PR-A에서 소멸. |
| F11 | PR-B CRUD가 `externalId`(개인 이메일=PII)를 view 권한자에 노출 | high | **FIXED(PR-B 설계)** | §6 — view는 name·상태·opaque key·카운트만, externalId 표시·편집은 `configure` 권한 한정. view-only 응답에 externalId 미포함 테스트. |
| F12 | 무인증 릴레이 시 `secret.smtp`(비밀번호) 항목 행이 "설정 필요"로 떠 그룹 헤더(정상)와 모순 | medium | **FIXED** | §5.3 — 비밀번호 행 상태도 auth 분기 따름(`SMTP_USER` 있을 때만 요구). §7 행/헤더 일관성 테스트. |
| F13 | §3에 rescope 후 남은 옛 문장(PR-A calendarIds→relational 링크가 PR-B 전 동작)이 "PR-A는 systemSetting 유지"와 모순 | high | **FIXED** | §3 — 모순 문장 삭제·재작성("PR-A는 relational/manageHref 두지 않음"). calendarIds/relational/manageHref/googleConfigured 전체 재스캔으로 다른 모순 없음 확인(line 42 유일). |

**후속(follow-up)**: ① SMTP/Google 연결 테스트(라이브 검증) 액션, ② PR-B의 seed calId 백필 완전 폐기 — 본 변경 범위 밖. PR-B(또는 별도 과제)에서 검토.

**적대검증 라운드 추세(미판정 blocking score, weight critical=4·high=3·medium=1)**: R1=6 → R2=1 → R3=6 → R4=6 → R5=4 → R6=7 → R7=3. 매 라운드가 새 실재 엣지를 드러냄(churn 아님). R6에서 **F6/F8/F10이 동일 뿌리(PR 분할로 인한 Google 관리 공백)로 3회 재발** → 패치 대신 **방향 결정(PR 재조정)**으로 닫음(F10): Google 전환 전체를 PR-B로 이동해 공백 제거·PR-A 안정화. R7은 rescope 후 남은 §3 leftover 모순(F13) 하나만 — 수정 후 calendarIds/relational/manageHref 전체 재스캔으로 일관성 확인(추가 모순 없음). 종료 시점 **PR-A 잔여 미판정 blocking 0** — FIXED: F1·F2·F4·F7·F9·F12·F13, ACCEPTED: F3, → PR-B 이관(별도 spec): F5·F6·F8(seed)·F11(PII). FIXED 항목은 impl 단계에서 §7 회귀 테스트로 재검증한다.
