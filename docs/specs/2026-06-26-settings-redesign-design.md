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

- **D1 — 연동 설정 진실원 = UI(DB), env는 fallback.** SMTP 전송 코드가 DB SystemSetting을 읽고, 해당 값이 비어 있으면 env로 폴백한다. UI 필드를 채우면 실제 메일 설정이 바뀐다.
- **D2 — SMTP 비밀번호는 env secret 유지.** 비밀번호는 비암호 SystemSetting/감사 로그에 두지 않는다. DB로 편집 가능한 SMTP 필드 = host/port/secure/user/fromAddress. password = `SMTP_PASSWORD`(env) 그대로.
- **D3 — SMTP 설정 해석기는 kernel에 둔다.** eslint boundaries상 `lib`는 `lib`만 import 가능하므로 메일 lib이 `@/kernel/settings`를 읽을 수 없다. 따라서 `getSmtpConfig()`(DB+env 폴백 해석)를 kernel(settings)에 두고, `sendMail`은 해석된 config를 **인자로 주입**받는다. 호출자(leave·workflows 모듈)가 `getSmtpConfig()`를 호출해 전달한다.
- **D4 — 상단 "연동 상태" 요약 카드 제거 → 영역 카드 헤더 배지로 일원화.** 상태 계산을 한 경로로 모아 요약-본문 모순을 구조적으로 제거한다.
- **D5 — 상태 점검은 실제 동작 출처를 본다.** SMTP `configured` = `SMTP_PASSWORD`(env) 존재 AND 해석된 host 비어있지 않음. Google `configured` = 서비스 계정 키(env) 존재 AND 활성 `GOOGLE_CALENDAR` 소스 ≥1개. 문서/템플릿 = LibreOffice 경로(env) 존재(현행 유지). `unknown`(인프라 장애) 3-state 구분은 유지(기존 `safe()`).
- **D6 — `integrations.google.calendarIds`(systemSetting) 폐기 → relational 항목으로 전환.** `manageHref = /admin/settings/calendar-sources`, `permission = integrations.google:configure`. 기존 SystemSetting row가 남아 있어도 무해(아무도 읽지 않음) — 별도 삭제 마이그레이션 불필요.
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
| mail | 메일 (SMTP) | `secret.smtp`(상태), `integrations.smtp.host/port/secure/user/fromAddress` |
| google | Google | `secret.google`(상태), `integrations.google.calendarIds`(relational) |
| documents | 문서 / 템플릿 | `secret.libreoffice`(상태) |
| leave | 연차 알림 | `leave.notifications.onRequest/onApprove/onReject` |
| workflows | 업무 | `workflows.weeklyReport.defaultRecipients`, `workflows.billing.config`(relational) |

**신규 SystemSetting 2종**(group=mail, permission=`integrations.smtp:configure`, audit=`summary`, fallbackSafe=true):
- `integrations.smtp.secure` — `z.boolean()`, default `false`. 라벨 "보안 연결(TLS)".
- `integrations.smtp.user` — `z.string()`, default `""`. 라벨 "사용자명".

**전환**: `integrations.google.calendarIds`를 `kind: "relational"`로 변경(model 명시 불필요/생략, `manageHref: "/admin/settings/calendar-sources"`).

### 5.2 SMTP DB 배선 (D1·D2·D3)

**kernel 해석기** — `src/kernel/settings/service.ts`에 추가, `reader.ts`에서 re-export(모듈은 `@/kernel/settings/reader`만 import 가능):

```ts
export interface ResolvedSmtpConfig {
  host: string;      // DB host || env SMTP_HOST || ""
  port: number;      // DB port || Number(env SMTP_PORT) || 587
  secure: boolean;   // DB secure ?? (env SMTP_SECURE === "true")
  user: string;      // DB user || env SMTP_USER || ""
  from: string;      // DB fromAddress || env SMTP_FROM || env SMTP_USER || "noreply@uracle.co.kr"
}
export async function getSmtpConfig(): Promise<ResolvedSmtpConfig>;
```
- 폴백 규칙: DB 값이 비어있지 않으면 DB, 아니면 env(D1). port는 무효 row면 `getSetting`이 throw — 호출자(상태 점검)는 기존 `safe()`로 환원.

**lib 변경** — `src/lib/integrations/mail/index.ts`:
- `sendMail(msg: MailMessage, config?: ResolvedSmtpConfig)`로 시그니처 확장.
- `buildTransport(config?)`: config가 있으면 `host/port/secure/user`를 config에서, `pass`는 `process.env.SMTP_PASSWORD`(D2). config 없으면 **현행 env-only 동작 보존**(테스트는 `setMailTransportForTests`로 우회하므로 무영향).
- `from`: `config?.from`가 있으면 사용, 없으면 기존 env 폴백 체인.

**호출자 변경** — `src/modules/leave/services/mail.ts`, `src/modules/workflows/services/mail.ts`:
- `const cfg = await getSmtpConfig(); await sendMail(msg, cfg);` (모듈→kernel import 허용).

### 5.3 상태 진실화 (D4·D5) — `src/modules/integrations/status.ts`, `src/app/(app)/admin/settings/page.tsx`

- `smtpConfigured()`: `getSmtpConfig()` 사용 → `secretOk(SMTP_PASSWORD)` AND `cfg.host.length > 0`. (host가 DB·env 어느 쪽에든 있으면 충족 → 실제 발송 가능 여부와 일치.)
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

- **kernel**: `getSmtpConfig` 폴백 규칙(DB 우선, env 폴백, 빈 값 처리) 단위 테스트.
- **lib**: `sendMail(msg, config)` — config 주입 시 transport 인자(host/port/secure/user, pass=env), config 미주입 시 현행 env 동작 보존(`setMailTransportForTests` fake로 인자 검증).
- **integrations 상태**: `smtpConfigured`(host 유무·secret 유무 조합), `googleConfigured`(소스 카운트·secret 조합), `unknown` 환원 회귀.
- **catalog/service**: 신규 키 등록·group/groupOrder 전파, `calendarIds` relational 전환.
- **UI(편집기)**: list 추가/삭제/형식검증, string/number 편집기 저장·롤백(rejected)·refetch 경로, boolean 회귀.
- 기존 스위트 그린 유지(현재 1380 통과 기준).

## 8. 배포 / 마이그레이션

- **Prisma 마이그레이션 없음**(D9) → 표준 restart 배포(`build` → `pm2 restart`). `db:seed`는 신규 권한 없으므로 불필요(SMTP/Google 권한 기존). 단 신규 SystemSetting 키는 카탈로그 등록만으로 동작(row는 첫 저장 시 생성, 미설정 시 default).
- 서버 env(`SMTP_HOST` 등)는 그대로 유지 — D1 폴백 덕에 DB 미입력 상태에서도 현행 메일 발송 무회귀.
- smoke: 인증 후 `/admin/settings` 렌더(영역 카드·상태 배지), SMTP 저장→메일 발송 1건, advisory 라우트 회귀(stale-build P2010 주의 — 인증 경로 포함).

## 9. 영향 범위 / 리스크

- **메일 전송 경로 변경**(working path) — D1 폴백으로 회귀 위험 최소화. 가장 큰 검증 포인트: config 미주입(테스트)·DB 빈 값(폴백)·DB 채움(신규) 3경우.
- `sendMail` 시그니처 확장 — 호출자 2곳(leave·workflows) 동시 갱신 필수.
- 상태 점검에 prisma count 추가(google) — feed 성능엔 영향 없음(설정 화면 1회 조회).
- 표현계층(IA·편집기) 변경은 도메인 불변식·동시성 패턴 무영향(설정 쓰기 토큰 패턴·audit 유지).
