# Phase 2 — 설정 체계 정리(Settings) 설계

- **Status:** Approved (brainstorming 2026-06-18)
- **Goal:** 설정 파편화(env·코드 상수·DB·템플릿 경로에 흩어짐)를 제거하고, **secret과 운영 설정을 분리**하며, 설정을 **검증·감사·일원화**하는 공통 기반을 세운다. 후속 Phase(Calendar=3, Workflows=4, Leave=5)가 소비할 설정 토대를 먼저 깐다.
- **관련 문서:** [roadmap](../product/modernization-roadmap.md) Phase 2, [day-sync-analysis §3·설정 화면](../discovery/day-sync-analysis.md), [access-control](../architecture/access-control.md), [Phase 1 plan](../plans/2026-06-17-phase-1-foundation.md)(SC-1 경계·SC-9 카탈로그 패턴 계승).

---

## 1. 범위

### 1.1 In scope (Standard depth)

- 설정 **registry**(typed access over `SystemSetting`) + **카탈로그**(설정 항목의 단일 조립 지점) + secret/운영설정 경계.
- **env/secret 검증**: boot-time fail-fast + 런타임 상태 리포트(`getSecretStatus`).
- **설정 홈 UI**(`/admin/settings`): 카테고리 섹션 + 연동 상태 카드(read-only) + `systemSetting` kind 인라인 편집기.
- **형식 검증**(Zod): 설정 값 read/write 검증.

### 1.2 Out of scope (확정 deferred)

- **실연결 프로브**(실제 SMTP 발송, Google API 호출, LibreOffice 실행) → 연동 클라이언트가 생기는 **Phase 4**. Phase 2는 present/valid **상태만** 표시.
- **`relational` 설정 편집기 CRUD**(BillingConfig 등) → `modules/workflows`가 생기는 **Phase 4**. Phase 2는 카탈로그에 **등록·링크까지만**.
- **모듈 기여형 카탈로그 동적 조립** → Phase 2는 정적 조립이되, 타입을 조립 가능 구조로 열어둠(§2.5).

### 1.3 브레인스토밍 확정 결정

| 결정 | 값 |
| --- | --- |
| Phase 2 방향 | 설정 체계(로드맵 원안 유지) |
| 깊이 | Standard — registry + 기존모델 등록 + 형식검증, 실연결 프로브 defer |
| secret 경계 | boot-time 검증 + 런타임 상태 둘 다 |
| 저장 추상화 | 접근 1 — typed registry over `SystemSetting`, 관계형은 기존 모델 유지 |

---

## 2. 아키텍처와 모듈 경계

### 2.1 디렉터리 배치

```text
src/
  kernel/settings/
    definitions.ts   ← 순수: 카탈로그(Zod schema + 메타). server-only 의존 없음 → client/server 공유
    repository.ts    ← server-only: prisma 접근(SystemSetting + AuditLog, tx)
    service.ts       ← server-only: getSetting/setSetting/listSettings 로직
    reader.ts        ← server-only: 모듈용 read-only facade(getSetting만)
    index.ts         ← app용 facade(service 재노출)
  lib/env/
    schema.ts        ← process.env Zod 스키마
    index.ts         ← server-only: boot-time parse(env) + getSecretStatus()
  modules/integrations/
    status.ts        ← 연동 상태 계산(설정값은 reader로 read-only)
    index.ts
  app/(app)/admin/settings/
    page.tsx, *       ← 설정 홈/상태 카드/편집기
  app/api/admin/settings/
    route.ts            (GET listSettings)
    [key]/route.ts      (PUT setSetting)
```

### 2.2 의존 방향 (Phase 1 SC-1 boundaries 정합)

- `kernel/settings` → `kernel/*`(audit) + `lib/*`(prisma) 만. **모듈 import 금지** → registry를 kernel에 두는 이유(모듈에 두면 `integrations`가 못 씀, module→module 금지).
- `lib/env` → lib only.
- `modules/integrations` → `kernel/settings/reader`(read-only) + `lib/env`. **`setSetting` import 불가**(구조적 write 차단).
- `app/.../settings`, `app/api/admin/settings` → 위 전부.

### 2.3 registry 책임 범위 (명시 요구 #1)

`kernel/settings`가 **책임지는 것**:
- 카탈로그 정의 보유(definitions).
- `systemSetting` kind 값의 typed read(default/override 결정) · write(검증·감사·concurrency).
- 카탈로그 뷰 조립(권한 필터 포함) for UI.

`kernel/settings`가 **책임지지 않는 것**:
- `relational` 설정의 CRUD(도메인 모듈 소유).
- secret **값** 관리(env/파일 소유, `lib/env`가 상태만 노출).
- 실연결 프로브(Phase 4).

### 2.4 내부 계층화

index에 로직을 몰지 않는다. `service → repository → prisma` 계층을 kernel 내부에도 적용(Phase 1 동일 패턴). `definitions.ts`는 순수 데이터/스키마라 어느 계층에서도 import 가능.

### 2.5 확장 경로 (assembly point)

`definitions.ts`의 카탈로그는 **"Phase 2 설정 카탈로그의 단일 조립 지점"**이다(전역 SSOT 아님). 장기적으로 각 모듈이 자기 `settings-definition`을 제공하고, 조립 계층(app 또는 kernel 조립 모듈)이 concat하는 구조로 확장 가능해야 한다. 카탈로그 타입은 이 확장을 허용하도록 **배열 조립** 형태로 둔다. Phase 2는 정적 배열로 충분하므로 동적 등록 메커니즘은 구현하지 않는다.

---

## 3. 저장 분류·키 규약·secret 정책

### 3.1 저장 3분류 (카탈로그가 통합)

| kind | 대상 | 저장 위치 | 검증 | UI |
| --- | --- | --- | --- | --- |
| `systemSetting` | 스칼라/작은 구조 설정 | `SystemSetting` key/value Json | Zod | 인라인 편집기 |
| `relational` | 이미 도메인 모델 성격 강한 것(BillingConfig 등) | 기존 관계형 모델 + 자체 service | 도메인 소유 | 카탈로그는 메타+`manageHref`만, 편집기 Phase 4 |
| `envSecret` | secret/API key | **env/파일 only, DB 미저장** | `lib/env` Zod + 파일 존재 | present/valid 상태만 |

- `SystemSetting`은 `systemSetting` kind 전용. 큰 컬렉션·관계형은 들어가지 않는다.
- `RecipientList`류는 검색/권한/개별 이력/참조가 아직 불필요 → `systemSetting`(JSON+Zod)로 충분. 모델 승격 안 함(필요해지면 후속 Phase에서 승격).

### 3.2 키 네이밍 규약 (명시 요구: 키 문법)

`systemSetting` 키 = **`<module>.<feature>.<setting>`** 점-네임스페이스. 모듈 prefix는 Phase 1 `RESOURCES` permission 키와 정렬.

- `envSecret`은 `settingKey`를 **갖지 않는다**(§4.1 discriminated union). env 변수명은 별도 필드 `envVars`로 분리 → DB setting key와 타입 레벨에서 섞이지 않는다.
- `relational`은 와일드카드 대신 **단일 구체 키**(예: `workflows.billing.config`) — 테스트·권한 매핑 단순화.

### 3.3 secret 정책 (명시 요구: secret 평문 금지)

- secret은 `SystemSetting`에 **평문 JSON으로 절대 저장하지 않는다.**
- **1차 방어선(allowlist)**: `setSetting`은 카탈로그에 존재하고 `kind === "systemSetting"`인 키만 허용. 미등록 임의 키 write 거부, `envSecret`/`relational` 키 write 거부(§5.2).
- **2차 방어선(defense-in-depth)**: "`SystemSetting`에 secret 패턴 키 부재"를 검사하는 테스트.

### 3.4 SMTP 분류 기준 (SSOT)

> 운영 중 UI에서 바꾸는 값 = `systemSetting`. 배포 환경에 묶이는 값 = `env`(secret이면 `envSecret`).

| 값 | 분류 |
| --- | --- |
| SMTP password / credentials | `envSecret` |
| SMTP host, port, fromAddress | `systemSetting`(운영 튜닝값) |

(host/port가 배포 고정이라면 env로 내릴 수 있으나, 기본은 위 표를 따른다.)

---

## 4. 카탈로그 (definitions.ts)

### 4.1 타입 (discriminated union)

```ts
export type SettingCategory = "security" | "integrations" | "workflows" | "general";
export type AuditMode = "full" | "redacted" | "summary";

type SettingEntryBase = {
  category: SettingCategory;
  order: number;
  title: string;
  description: string;
  requiredPermission: string;   // "resource:action" (Phase 1 catalog 키)
};

export type SettingEntry =
  | (SettingEntryBase & {
      kind: "systemSetting";
      settingKey: string;        // "<module>.<feature>.<setting>"
      schema: ZodTypeAny;
      default: JsonValue;
      audit: AuditMode;          // PII 보호(§5.6)
    })
  | (SettingEntryBase & {
      kind: "relational";
      model: string;             // dev 메타 — UI는 분기에 사용 안 함
      manageHref: string;
    })
  | (SettingEntryBase & {
      kind: "envSecret";
      envVars: string[];         // settingKey 없음 → DB 키와 분리
      filePath?: boolean;        // 값이 파일 경로면 존재 확인
    });
```

`model`은 **개발자용 메타**다. UI 화면은 `title·description·manageHref·requiredPermission·status`만 보고, `model` 문자열로 로직을 분기하지 않는다.

### 4.2 Phase 2 카탈로그 항목(초안)

| key / envVars | kind | category | requiredPermission | audit |
| --- | --- | --- | --- | --- |
| `DATABASE_URL`, `NEXTAUTH_SECRET` | envSecret | security | `admin.settings:view` | — |
| `GOOGLE_APPLICATION_CREDENTIALS`(filePath) | envSecret | integrations | `integrations.google:view` | — |
| `SMTP_PASSWORD` | envSecret | integrations | `integrations.smtp:view` | — |
| `LIBREOFFICE_PATH`(filePath) | envSecret | integrations | `integrations.templates:view` | — |
| `integrations.smtp.host` / `.port` / `.fromAddress` | systemSetting | integrations | `integrations.smtp:configure` | `.fromAddress`=redacted, 그 외 full |
| `integrations.google.calendarIds` | systemSetting | integrations | `integrations.google:configure` | full |
| `workflows.weeklyReport.defaultRecipients` | systemSetting | workflows | `workflows.weekly:configure` | summary(이메일 PII) |
| `workflows.billing.config` | relational(BillingConfig) | workflows | `workflows.billing:configure` | — |

(권한 키는 Phase 1 access 카탈로그와 대조해 seed 단계에서 확정. 없으면 카탈로그 키를 추가.)

---

## 5. Registry API와 read/write 경로

### 5.1 read — `getSetting` (fail-safe)

```ts
getSetting<K>(key: K): Promise<Value<K>>;
```

- **미등록 key → `UnknownSettingError` throw**(코드 버그, fail-fast).
- **등록 key, row 없음 → catalog `default`.**
- **등록 key, row 있고 Zod 유효 → 그 값.**
- **등록 key, row 있고 Zod invalid → `default` 반환 + `status=INVALID` 플래그(+warn 로그). throw 안 함.**

read는 throw하지 않는다(설정 read는 핫패스). 잘못된 레거시 값이 앱을 막지 않고 "조치 필요"로만 표시된다.

### 5.2 write — `setSetting` (fail-closed)

```ts
setSetting<K>(key: K, value: Value<K>, ctx: { actorId: string; expectedUpdatedAt?: Date | null }): Promise<{ updatedAt: Date }>;
```

throws:
- 미등록 key → `UnknownSettingError`.
- 등록됐으나 `kind !== "systemSetting"`(envSecret/relational) → **`SettingNotWritableError`**.
- Zod 실패 → `SettingValidationError`.
- concurrency 불일치 → `SettingConcurrencyError`.

권한 검사는 API 계층에서 `requirePermission(catalog.requiredPermission)`로(§7.3).

### 5.3 default/override 정책 (명시 요구 #3)

우선순위: **`SystemSetting` row(유효) > catalog `default`**. row 없음 → default. catalog default는 코드 보유이므로, 값이 default와 같으면 row를 만들지 않아도 된다(override일 때만 row 생성).

### 5.4 invalid legacy value 처리 (명시 요구 #4)

- read: Zod 실패 → default + `status=INVALID`(listSettings에 노출, UI 경고 배지). **throw 안 함.**
- write: Zod 실패 → `SettingValidationError`(reject).
- 관리자가 유효 값으로 재저장하기 전까지 INVALID 상태 유지.

### 5.5 audit/write 강제 (명시 요구 #6)

- 모든 변경은 `setSetting` 경유. 내부 단일 `prisma.$transaction`에서 **`SystemSetting` upsert + `AuditLog` insert 동시** 기록. audit insert 실패 → 전체 롤백(감사 없는 설정 변경 불가).
- AuditLog: `entityType="SystemSetting"`, `entityId=key`, `action="settings.update"`, `metadata`=§5.6 정책에 따른 before/after.
- repository 밖 직접 `SystemSetting` write 금지 — 모듈은 `reader`만(read-only), 직접 prisma write 부재를 테스트로 가드.

### 5.6 audit redaction (PII 보호)

카탈로그 `audit` 모드로 metadata 기록 방식 결정:
- `full`: before/after 원값.
- `redacted`: 값 제거(변경 사실만, 예: `{ changed: true }`).
- `summary`: 구조 요약(배열=길이+해시 prefix, 객체=키 이름만) — 원 PII 없음.

기본 수신자 목록·SMTP fromAddress 등 이메일은 PII → `summary`/`redacted`. 테스트가 "PII 엔트리 metadata에 원값 부재"를 강제.

### 5.7 optimistic concurrency (명시 요구: 동시 수정)

`expectedUpdatedAt` 토큰 의미:
- `null` = "아직 override row 없어야 함"(최초 생성 가드). tx 내 row 발견 시 `SettingConcurrencyError`(다른 관리자가 먼저 생성).
- `Date` = 해당 버전 update. 현재 updatedAt 불일치 또는 row 삭제됨 → `SettingConcurrencyError`.
- `undefined`(생략) = last-write-wins(명시적 opt-out).

판정은 tx 내 현재 row 재조회로 수행. UI는 로드 시점 토큰을 전달, 충돌 시 "다른 사용자가 먼저 변경 — 새로고침".

### 5.8 listSettings — 서버 1차 권한 필터

```ts
listSettings(userId: string): Promise<SettingsCatalogView>;
```

- 호출자 permission summary로 **서버에서** 항목 필터 → 권한 없는 `title/description/status`는 응답에 미포함(client `useCan`은 2차 보조 필터).
- secret **값은 제외**, status만 merge(§6).
- 카탈로그 뷰 항목의 `status`:
  - `systemSetting`: `OK`(유효 override 또는 default) / `INVALID`(저장값 Zod 실패, §5.4).
  - `envSecret`: `PRESENT`(존재·유효) / `ABSENT`(미설정) / `WARN`(optional 미설정 또는 파일 경로 부재) — 값은 미포함.
  - `relational`: `LINK`(편집기로 위임, Phase 2는 관리 링크만).

### 5.9 relation-backed 설정의 카탈로그 연결 (명시 요구 #5)

`relational` 엔트리는 **메타데이터만** 보유(`model`+`manageHref`+권한). kernel은 도메인 service를 import하지 않는다(경계 유지). 설정 홈은 엔트리를 "관리 →" 링크로 렌더, 실제 편집기는 도메인(Phase 4)에 둔다.

---

## 6. env/secret 검증 (lib/env) — boot-time + 런타임

- `lib/env/schema.ts`: `process.env` Zod 스키마. required(`DATABASE_URL`, `NEXTAUTH_SECRET`) / optional(`SMTP_PASSWORD`, `GOOGLE_APPLICATION_CREDENTIALS`, `LIBREOFFICE_PATH`, template/output dir).
- `lib/env/index.ts`: import 시 1회 parse → `export const env`. required 누락/형식오류 → **boot fail-fast**. **`import "server-only"`로 고정**(클라이언트 번들 유입 시 빌드 에러).
- `getSecretStatus(): SecretStatus[]`: 선언된 env/파일경로별 `{ name, present, valid, detail }` 반환. **값은 절대 미반환**. `filePath` secret은 `fs.existsSync`로 존재 확인까지(실 API 호출=프로브는 Phase 4 defer). **server-only.**

---

## 7. UI (app)

### 7.1 설정 홈 `/admin/settings`

- `listSettings(userId)` 결과를 `category` 그룹 · `order` 정렬로 섹션 렌더.
- 항목 카드 = `title/description/status` + (systemSetting→인라인 편집 / relational→`manageHref` 링크 / envSecret→상태 배지).
- `useCan(requiredPermission)`로 2차 필터(1차는 API).

### 7.2 편집기·상태 카드

- 편집기(Phase 2 실제): `systemSetting` kind만. client는 `definitions.ts`의 Zod로 **UX 최소 검증**, server `service`가 **진짜 기준**. `updatedAt` hidden으로 concurrency.
- 상태 카드(read-only): `envSecret`(보안·연동) + `relational`(billing→Phase 4 편집기 예정 링크).

### 7.3 API

- `GET /api/admin/settings` → `listSettings(session.user.id)`.
- `PUT /api/admin/settings/[key]` → `setSetting`. 둘 다 `requirePermission(catalog.requiredPermission)` 선검사. server-only.

---

## 8. 에러 처리

| 경로 | 조건 | 처리 |
| --- | --- | --- |
| read | 미등록 key | throw `UnknownSettingError`(버그) |
| read | 등록·invalid/absent row | default + `status=INVALID`(throw 안 함) |
| write | Zod 실패 | 422 `SettingValidationError` |
| write | concurrency 불일치 | 409 `SettingConcurrencyError` |
| write | 권한 없음 | 403 `ForbiddenError` |
| write | 미등록 key | 404 `UnknownSettingError` |
| write | envSecret/relational key | 400 `SettingNotWritableError` |
| env | required 누락/형식 | boot **fail-fast** |
| env | optional 누락 | status WARN |

---

## 9. 테스트 기준 (명시 요구 #7)

- **service(TDD)**: 미등록 key→throw / no row→default / valid row→값 / invalid row→default+INVALID(no throw) / setSetting Zod reject / envSecret·relational→`SettingNotWritableError` / 미등록→`UnknownSettingError` / **audit 동일 tx(감사 insert 실패 시 설정도 롤백)** / concurrency: null·Date·undefined 3케이스 / **redacted·summary 엔트리 metadata에 원 PII 부재**.
- **env**: required 누락→boot throw / `getSecretStatus` present·absent·invalid, **값 미반환**.
- **카탈로그 정합성**: 모든 systemSetting 키가 `<module>.<feature>.<setting>` 문법 + schema·default 보유 / settingKey 집합과 envVars 집합 무교집합 / envSecret엔 settingKey 없음 / 모든 엔트리에 category·order·requiredPermission 존재.
- **경계 가드**: modules는 `kernel/settings/reader`만 import(lint `no-restricted-imports` + test) / repository 밖 직접 `SystemSetting` write 없음(test) / `lib/env`·service·repository는 server-only(클라이언트 import 시 실패).
- **API 권한**: listSettings가 권한 없는 항목을 응답에서 제외(서버 1차 필터) / PUT가 requiredPermission 없으면 403.

---

## 10. 스키마·seed·nav 영향

- **스키마: 변경 없음(검증됨).** Phase 2가 쓰는 `SystemSetting.updatedAt`, `AuditLog.{metadata, entityType, entityId, action}`가 현 `schema.prisma`에 모두 존재 → **migration 불필요.** (전제: 위 필드 존재. 추후 필드가 빠지면 그때만 migration 추가.)
- **seed**: 카탈로그 default는 코드 보유(row는 override일 때만 생성) → seed 거의 무변경. `admin.settings`·`integrations.*` 권한은 Phase 1에서 이미 seed됨 → 재사용(필요 시 `*:configure` 키 보강).
- **nav**: settings는 `/admin` 하위 라우트 → 상단 nav 5종 불변.

---

## 11. 명시 요구 7대 항목 매핑

| 요구 | 위치 |
| --- | --- |
| 1. registry 책임 범위 | §2.3 |
| 2. module/kernel 의존 방향 | §2.1·§2.2 |
| 3. default/override 정책 | §5.3 |
| 4. invalid legacy value 처리 | §5.4 |
| 5. relation-backed setting 카탈로그 연결 | §3.1·§4.1·§5.9 |
| 6. audit/write path 강제 규칙 | §3.3·§5.5·§5.6 |
| 7. 테스트 기준 | §9 |
