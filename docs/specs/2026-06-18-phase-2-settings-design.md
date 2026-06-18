# Phase 2 — 설정 체계 정리(Settings) 설계

- **Status:** Approved (brainstorming 2026-06-18) · Codex 적대적 리뷰 반영 v2 (2026-06-18, §12)
- **Goal:** 설정 파편화(env·코드 상수·DB·템플릿 경로에 흩어짐)를 제거하고, **secret과 운영 설정을 분리**하며, 설정을 **검증·감사·일원화**하는 공통 기반을 세운다. 후속 Phase(Calendar=3, Workflows=4, Leave=5)가 소비할 설정 토대를 먼저 깐다.
- **관련 문서:** [roadmap](../product/modernization-roadmap.md) Phase 2, [day-sync-analysis §3·설정 화면](../discovery/day-sync-analysis.md), [access-control](../architecture/access-control.md), [Phase 1 plan](../plans/2026-06-17-phase-1-foundation.md)(SC-1 경계·SC-5 권한 API·SC-9 카탈로그 패턴 계승).

---

## 1. 범위

### 1.1 In scope (Standard depth)

- 설정 **registry**(typed access over `SystemSetting`) + **카탈로그**(설정 항목의 단일 조립 지점) + secret/운영설정 경계.
- **env/secret 검증**: boot-time fail-fast + 런타임 상태 리포트(`getSecretStatus`, admin 전용·coarse).
- **설정 홈 UI**(`/admin/settings`): 카테고리 섹션 + 연동 상태 카드(read-only) + `systemSetting` kind 인라인 편집기.
- **형식 검증**(Zod): 설정 값 read/write 검증.

### 1.2 Out of scope (확정 deferred)

- **실연결 프로브**(실제 SMTP 발송, Google API 호출, LibreOffice 실행) → 연동 클라이언트가 생기는 **Phase 4**. Phase 2는 present/valid **상태만** 표시.
- **`relational` 설정 편집기 CRUD**(BillingConfig 등) → `modules/workflows`가 생기는 **Phase 4**. Phase 2는 카탈로그에 **등록·링크까지만**(§5.9, Codex Finding 12 주의 — 마찰 시 일반 링크로 강등 가능).
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
    registry.ts      ← 순수 타입·SettingEntry 유니온·AuditMode 등 registry 1차 요소(도메인 무관, type-only)
    catalog.ts       ← server-only: Phase 2 구체 설정 항목 조립 지점(§2.5) — 클라이언트로 보내지 않음
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

> **카탈로그는 server-only**(Codex Finding 2). `catalog.ts`/`service.ts`/`repository.ts`/`reader.ts`는 `import "server-only"`. 클라이언트 번들에 설정 title/description/env 변수명/secret 인벤토리가 유입되지 않게 한다. 클라이언트 검증은 §7.2의 최소 UX 검증만 받고, **서버 Zod가 유일 기준**이다.

### 2.2 의존 방향 (Phase 1 SC-1 boundaries 정합)

- `kernel/settings` → `kernel/*`(access, audit) + `lib/*`(prisma) 만. **모듈 import 금지** → registry를 kernel에 두는 이유(모듈에 두면 `integrations`가 못 씀, module→module 금지).
- `lib/env` → lib only.
- `modules/integrations` → `kernel/settings/reader`(read-only) + `lib/env`. **`setSetting` import 불가**(구조적 write 차단).
- `app/.../settings`, `app/api/admin/settings` → 위 전부.

### 2.3 registry 책임 범위 (명시 요구 #1)

`kernel/settings`가 **책임지는 것**:
- registry 1차 요소(타입·유니온) + Phase 2 카탈로그 조립.
- `systemSetting` kind 값의 typed read(default/override 결정) · write(검증·감사·concurrency).
- 카탈로그 뷰 조립(서버 권한 필터 포함) for UI.

`kernel/settings`가 **책임지지 않는 것**:
- `relational` 설정의 CRUD(도메인 모듈 소유).
- secret **값** 관리(env/파일 소유, `lib/env`가 상태만 노출).
- 실연결 프로브(Phase 4).

### 2.4 내부 계층화

index에 로직을 몰지 않는다. `service → repository → prisma` 계층을 kernel 내부에도 적용(Phase 1 동일 패턴). `registry.ts`는 순수 타입이라 어느 계층에서도 import 가능(type-only).

### 2.5 확장 경로 (assembly point) + kernel 적재 부채 (Codex Finding 11)

`catalog.ts`는 **"Phase 2 설정 카탈로그의 단일 조립 지점"**이다(전역 SSOT 아님). registry **1차 요소(타입·메커니즘)**는 `registry.ts`에, **구체 항목(SMTP·Google·weekly 수신자·billing)**은 `catalog.ts`에 분리해 둔다.

> **알려진 부채**: 구체 도메인 설정을 kernel에 두면 kernel이 cross-domain dumping ground가 될 위험이 있다(Codex Finding 11). 다만 모듈은 module→module 금지로 서로의 설정을 못 읽고 `reader`로만 접근하므로, Phase 2 범위에서는 kernel 조립을 유지한다(사용자 결정). **장기적으로는 각 모듈이 자기 `settings-definition`을 제공하고 조립 계층(app 또는 전용 composition)이 concat**하는 구조로 이전한다. 카탈로그 타입은 이 확장을 허용하도록 **배열 조립** 형태로 둔다. Phase 2는 동적 등록 메커니즘은 구현하지 않는다.

---

## 3. 저장 분류·키 규약·secret 정책

### 3.1 저장 3분류 (카탈로그가 통합)

| kind | 대상 | 저장 위치 | 검증 | UI |
| --- | --- | --- | --- | --- |
| `systemSetting` | 스칼라/작은 구조 설정 | `SystemSetting` key/value Json | Zod | 인라인 편집기 |
| `relational` | 이미 도메인 모델 성격 강한 것(BillingConfig 등) | 기존 관계형 모델 + 자체 service | 도메인 소유 | 카탈로그는 메타+`manageHref`만, 편집기 Phase 4 |
| `envSecret` | secret/API key | **env/파일 only, DB 미저장** | `lib/env` Zod + 파일 존재 | present/valid 상태만(admin) |

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

## 4. 카탈로그 (registry.ts 타입 + catalog.ts 항목)

### 4.1 타입 (discriminated union)

```ts
import type { Action } from "@/kernel/access";   // Phase 1 타입 재사용(SC-5)

export type SettingCategory = "security" | "integrations" | "workflows" | "general";
export type AuditMode = "full" | "redacted" | "summary";

type SettingEntryBase = {
  category: SettingCategory;
  order: number;
  title: string;
  description: string;
  // 단일 "resource:action" 문자열 아님 — Phase 1 API 시그니처와 정합(Codex Finding 1)
  permission: { resource: string; action: Action };
};

export type SettingEntry =
  | (SettingEntryBase & {
      kind: "systemSetting";
      settingKey: string;        // "<module>.<feature>.<setting>"
      schema: ZodTypeAny;
      default: JsonValue;
      audit: AuditMode;          // 기본 summary(§5.6, Finding 7)
      fallbackSafe: boolean;     // invalid 저장값에 default 사용해도 운영상 안전한가(§5.4, Finding 6)
    })
  | (SettingEntryBase & {
      kind: "relational";
      model: string;             // dev 메타 — UI 분기 금지(§5.9)
      manageHref: string;
    })
  | (SettingEntryBase & {
      kind: "envSecret";
      // 항목별 종류 분리 — 배열 전체 filePath 플래그 금지(Codex Finding 13)
      envVars: Array<{ name: string; kind: "value" | "filePath" }>;
    });
```

`model`은 **개발자용 메타**다. UI 화면은 `title·description·manageHref·permission·status`만 보고, `model` 문자열로 로직을 분기하지 않는다.

**typed key→value 매핑(Codex Finding 14)**: `catalog.ts`를 `as const`로 선언하고 systemSetting 엔트리의 `settingKey`→`schema`를 매핑한다.

```ts
type SystemEntry = Extract<(typeof CATALOG)[number], { kind: "systemSetting" }>;
type SettingValueMap = { [E in SystemEntry as E["settingKey"]]: z.infer<E["schema"]> };
export function getSetting<K extends keyof SettingValueMap>(key: K): Promise<SettingValueMap[K]>;
```

타입 매핑이 과하면 Phase 2는 `getSetting(key: string): Promise<unknown>` + 호출부 `schema.parse` 경계로 단순화(택1, 구현 플랜에서 확정).

### 4.2 Phase 2 카탈로그 항목(초안)

permission은 `{ resource, action }`. 표는 `resource:action` 표기로 표시.

| key / envVars | kind | category | permission | audit | fallbackSafe |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL`, `NEXTAUTH_SECRET` | envSecret | security | `admin.settings:view` | — | — |
| `GOOGLE_APPLICATION_CREDENTIALS`(filePath) | envSecret | integrations | `integrations.google:view` | — | — |
| `SMTP_PASSWORD` | envSecret | integrations | `integrations.smtp:view` | — | — |
| `LIBREOFFICE_PATH`(filePath) | envSecret | integrations | `integrations.templates:view` | — | — |
| `integrations.smtp.host` / `.port` / `.fromAddress` | systemSetting | integrations | `integrations.smtp:configure` | `.fromAddress`=summary, host/port=full | false(운영 직접 사용) |
| `integrations.google.calendarIds` | systemSetting | integrations | `integrations.google:configure` | **summary**(캘린더 ID=이메일 가능, Finding 7) | false |
| `workflows.weeklyReport.defaultRecipients` | systemSetting | workflows | `workflows.weekly:configure` | summary(이메일 PII) | true(목록 비면 발송측에서 처리) |
| `workflows.billing.config` | relational(BillingConfig) | workflows | `workflows.billing:configure` | — | — |

> permission 키는 §10 seed 확인 결과 일부 미존재 → **seed 보강 필요**(Codex Finding 5): `workflows.weekly:configure`, `workflows.billing:configure`(+ `admin.settings:view` 존재 확인). 자세히는 §10.

---

## 5. Registry API와 read/write 경로

### 5.1 read — `getSetting` (운영 read) vs UI 목록 read

`getSetting`(운영 read):
- **미등록 key → `UnknownSettingError` throw**(코드 버그, fail-fast).
- **등록 key, row 없음 → catalog `default`.**
- **등록 key, row 있고 Zod 유효 → 그 값.**
- **등록 key, row 있고 Zod invalid:**
  - `fallbackSafe === true` → `default` 반환 + warn 로그(목록·표시용 무해).
  - `fallbackSafe === false` → **`SettingInvalidError` throw**(SMTP/calendar 등 운영값은 깨진 override를 숨기지 않는다, Codex Finding 6).

`listSettings`(UI 목록, §5.8)는 **절대 throw 안 함** — invalid는 잡아 `status=INVALID`로 표시(핫패스·화면 보호). 즉 "조치 필요"만 노출하고 앱을 막지 않는다.

### 5.2 write — `setSetting` (fail-closed)

```ts
setSetting<K>(key: K, value: Value<K>, ctx: { actorId: string; expectedUpdatedAt?: Date | null }): Promise<{ updatedAt: Date }>;
```

throws:
- 미등록 key → `UnknownSettingError`.
- 등록됐으나 `kind !== "systemSetting"`(envSecret/relational) → **`SettingNotWritableError`**.
- Zod 실패 → `SettingValidationError`.
- concurrency 불일치 → `SettingConcurrencyError`.
- `actorId` 누락/빈값 → `SettingActorRequiredError`(런타임 강제, §5.5, Codex Finding 9).

권한 검사는 API 계층에서 `requirePermission(userId, resource, action)`로(§7.3) — 카탈로그 `permission`을 인자로 전개.

### 5.3 default/override 정책 (명시 요구 #3)

우선순위: **`SystemSetting` row(유효) > catalog `default`**. row 없음 → default. catalog default는 코드 보유이므로, 값이 default와 같으면 row를 만들지 않아도 된다(override일 때만 row 생성).

### 5.4 invalid legacy value 처리 (명시 요구 #4, Codex Finding 6)

- **운영 read(`getSetting`)**: `fallbackSafe`로 분기 — true면 default+warn, false면 `SettingInvalidError` throw.
- **UI 목록(`listSettings`)**: 항상 default + `status=INVALID`(경고 배지). throw 안 함.
- **write**: Zod 실패 → `SettingValidationError`(reject).
- 관리자가 유효 값으로 재저장하기 전까지 INVALID 상태 유지.

### 5.5 audit/write 강제 (명시 요구 #6, Codex Finding 9)

- 모든 변경은 `setSetting` 경유. 내부 단일 `prisma.$transaction`에서 **`SystemSetting` upsert + `AuditLog` insert 동시** 기록. audit insert 실패 → 전체 롤백(감사 없는 설정 변경 불가).
- **actorId 비-null 런타임 강제**: `AuditLog.actorId`/`writeAudit`는 구조상 null 허용이지만, 설정 전용 감사 헬퍼는 **null/빈 actorId를 거부**한다. 설정 변경은 항상 행위자가 있어야 한다(`SettingActorRequiredError`).
- AuditLog: `entityType="SystemSetting"`, `entityId=key`, `action="settings.update"`, `metadata`=§5.6 정책에 따른 before/after.
- repository 밖 직접 `SystemSetting` write 금지 — 모듈은 `reader`만(read-only), 직접 prisma write 부재를 테스트로 가드.

### 5.6 audit redaction (PII 보호, Codex Finding 7)

카탈로그 `audit` 모드로 metadata 기록 방식 결정:
- `full`: before/after 원값.
- `redacted`: 값 제거(변경 사실만, 예: `{ changed: true }`).
- `summary`: 구조 요약(배열=길이+해시 prefix, 객체=키 이름만) — 원 PII 없음.

**기본은 `summary`** — 배열·이메일·ID·주소류는 명시적 정당화 없이는 `summary`로 둔다. `full`은 비-PII 스칼라(host/port 등)에만, 정당화와 함께 사용. 테스트가 "PII 예시 엔트리 metadata에 원값 부재"를 강제.

### 5.7 optimistic concurrency (명시 요구: 동시 수정 / Codex Finding 8)

`expectedUpdatedAt` 토큰 의미:
- `null` = "아직 override row 없어야 함"(최초 생성 가드).
- `Date` = 해당 버전 update.
- `undefined`(생략) = last-write-wins(명시적 opt-out).

**원자적 repository 알고리즘(구체):**
- `null`: `create`로 삽입 시도 → unique 위반(Prisma `P2002`) catch → `SettingConcurrencyError`(다른 관리자가 먼저 생성).
- `Date`: `updateMany({ where: { key, updatedAt: expectedUpdatedAt }, data })` 실행 → **affected count === 0 이면** `SettingConcurrencyError`(버전 불일치 또는 row 삭제).
- `undefined`: `upsert`(검사 없음).
- **Date 정밀도**: 클라이언트로 내보낸 `updatedAt`을 그대로 토큰으로 받아 비교(ISO 문자열 ↔ `Date` 직렬화 일관). DB 타임스탬프 정밀도(ms) 손실이 없도록 동일 표현으로 왕복한다.

UI는 로드 시점 토큰을 전달, 충돌 시 "다른 사용자가 먼저 변경 — 새로고침".

### 5.8 listSettings — 서버 1차 권한 필터 (Codex Finding 3·4·10)

```ts
listSettings(userId: string): Promise<SettingsCatalogView>;
```

- **admin 베이스 게이트**: 호출 전 `requirePermission(userId, "admin.settings", "view")` — 설정 홈/목록은 관리 영역이다. 좁은 `integrations.*` 권한만으로 설정 API에 접근 불가(Finding 3).
- **항목별 인가는 `hasPermission(userId, resource, action)`로 평가**(권한 엔진 직접 호출). `getPermissionSummary`(UI 최적화·scope 미인지)로 인가를 판단하지 않는다(Finding 10). 통과한 항목만 응답에 포함(권한 없는 title/description/status는 미포함).
- secret **값은 제외**, status만 merge(§6). client `useCan`은 2차 보조 필터.
- 카탈로그 뷰 항목의 `status`:
  - `systemSetting`: `OK`(유효 override 또는 default) / `INVALID`(저장값 Zod 실패, §5.4).
  - `envSecret`: **coarse 상태만** `configured` / `attention_required`(원 env 변수명·파일 경로·detail 미노출, Finding 4).
  - `relational`: `LINK`(편집기로 위임, Phase 2는 관리 링크만).

### 5.9 relation-backed 설정의 카탈로그 연결 (명시 요구 #5, Codex Finding 12)

`relational` 엔트리는 **메타데이터만** 보유(`model`+`manageHref`+`permission`). kernel은 도메인 service를 import하지 않는다(경계 유지). 설정 홈은 엔트리를 "관리 →" 링크로 렌더, 실제 편집기는 도메인(Phase 4)에 둔다.

> Codex Finding 12: relational kind는 Phase 2에서 편집 동작이 없어 조기 추상화 위험. **Phase 2는 `workflows.billing.config` 단일 엔트리만** 등록(점5 검증·관리 링크). 구현 중 타입/테스트 마찰이 크면 registry 밖 **정적 admin 링크**로 강등 가능.

---

## 6. env/secret 검증 (lib/env) — boot-time + 런타임 (Codex Finding 4)

- `lib/env/schema.ts`: `process.env` Zod 스키마. required(`DATABASE_URL`, `NEXTAUTH_SECRET`) / optional(`SMTP_PASSWORD`, `GOOGLE_APPLICATION_CREDENTIALS`, `LIBREOFFICE_PATH`, template/output dir).
- `lib/env/index.ts`: import 시 1회 parse → `export const env`. required 누락/형식오류 → **boot fail-fast**. **`import "server-only"`로 고정**.
- `getSecretStatus()`: 선언된 env/파일경로별 **coarse 상태**(`configured` / `attention_required`)만 반환. **값·원 env 변수명·파일 경로 detail은 반환하지 않는다**(secret 인벤토리·파일시스템 존재 노출 차단). `filePath` 항목은 `fs.existsSync`로 존재 확인하되 결과는 coarse 상태로만 환원. 실 API 호출(프로브)은 Phase 4. **server-only**, 호출부(API)는 `admin.settings:view`로 게이트.

---

## 7. UI (app)

### 7.1 설정 홈 `/admin/settings`

- `listSettings(userId)`(서버에서 admin 게이트 + 항목 인가 완료) 결과를 `category` 그룹 · `order` 정렬로 섹션 렌더.
- 항목 카드 = `title/description/status` + (systemSetting→인라인 편집 / relational→`manageHref` 링크 / envSecret→coarse 상태 배지).
- `useCan(resource, action)`로 2차 필터(1차는 API). — Phase 1 훅 시그니처(분리 인자) 사용.

### 7.2 편집기·상태 카드 (Codex Finding 2)

- 편집기(Phase 2 실제): `systemSetting` kind만. **클라이언트는 최소 UX 검증만**(빈값·기본 형식), **서버 `service`의 Zod가 유일 기준**. 전체 카탈로그/스키마를 클라이언트로 보내지 않는다. `updatedAt` hidden으로 concurrency.
- 상태 카드(read-only): `envSecret`(coarse 상태) + `relational`(billing→Phase 4 편집기 예정 링크).

### 7.3 API (Codex Finding 1·3)

- `GET /api/admin/settings` → `requirePermission(uid,"admin.settings","view")` 후 `listSettings(uid)`.
- `PUT /api/admin/settings/[key]` → `requirePermission(uid,"admin.settings","configure")` **그리고** 엔트리별 `requirePermission(uid, entry.permission.resource, entry.permission.action)` 둘 다 통과해야 write(Finding 3). 이후 `setSetting`.
- 둘 다 server-only.

---

## 8. 에러 처리

| 경로 | 조건 | 처리 |
| --- | --- | --- |
| read(운영) | 미등록 key | throw `UnknownSettingError`(버그) |
| read(운영) | invalid row, `fallbackSafe=true` | default + warn(throw 안 함) |
| read(운영) | invalid row, `fallbackSafe=false` | throw `SettingInvalidError` |
| read(UI 목록) | invalid row | default + `status=INVALID`(throw 안 함) |
| write | Zod 실패 | 422 `SettingValidationError` |
| write | concurrency 불일치 | 409 `SettingConcurrencyError` |
| write | actorId 누락 | 500/400 `SettingActorRequiredError` |
| write | admin 게이트/엔트리 권한 없음 | 403 `ForbiddenError` |
| write | 미등록 key | 404 `UnknownSettingError` |
| write | envSecret/relational key | 400 `SettingNotWritableError` |
| env | required 누락/형식 | boot **fail-fast** |
| env | optional 누락 | status `attention_required` |

---

## 9. 테스트 기준 (명시 요구 #7)

- **service(TDD)**: 미등록 key→throw / no row→default / valid row→값 / invalid+fallbackSafe=true→default(no throw) / invalid+fallbackSafe=false→`SettingInvalidError` / setSetting Zod reject / envSecret·relational→`SettingNotWritableError` / 미등록→`UnknownSettingError` / actorId 누락→`SettingActorRequiredError` / **audit 동일 tx(감사 insert 실패 시 설정도 롤백)** / concurrency: null(P2002)·Date(count 0)·undefined 3케이스 / **summary·redacted 엔트리 metadata에 원 PII 부재**.
- **env**: required 누락→boot throw / `getSecretStatus` coarse 상태만, **값·변수명·경로 미반환**.
- **권한/노출**: listSettings가 `admin.settings:view` 없으면 거부(베이스 게이트) / 항목 인가는 `hasPermission`으로 평가(summary 아님) / 권한 없는 항목 응답 제외 / PUT가 admin.settings:configure + 엔트리 권한 둘 다 요구.
- **클라이언트 누출**: 전체 카탈로그가 클라이언트 번들에 포함되지 않음(catalog server-only) — `server-only` import로 강제, 빌드 검증.
- **카탈로그 정합성**: 모든 systemSetting 키가 `<module>.<feature>.<setting>` 문법 + schema·default·permission·fallbackSafe 보유 / settingKey 집합과 envVars 이름 집합 무교집합 / envSecret엔 settingKey 없음 / 모든 엔트리에 category·order·permission 존재 / 카탈로그 permission이 seed에 실재(§10).
- **경계 가드**: modules는 `kernel/settings/reader`만 import(lint `no-restricted-imports` + test) / repository 밖 직접 `SystemSetting` write 없음(test) / `lib/env`·service·repository·catalog는 server-only.

---

## 10. 스키마·seed·nav 영향

- **스키마: 변경 없음(검증됨).** Phase 2가 쓰는 `SystemSetting.updatedAt`, `AuditLog.{metadata, entityType, entityId, action}`가 현 `schema.prisma`에 모두 존재 → **migration 불필요.** (전제: 위 필드 존재. 추후 필드가 빠지면 그때만 migration 추가.)
- **seed 보강 필요(Codex Finding 5, 검증됨)**: 현 `prisma/seed.ts`의 `EXTRA_PERMISSIONS`에 `integrations.*:configure`·`admin.settings:configure`는 있으나 **`workflows.weekly:configure`·`workflows.billing:configure`는 없다**. 카탈로그 permission이 fail-closed 되지 않도록:
  - `EXTRA_PERMISSIONS`에 `["workflows.weekly","configure"]`, `["workflows.billing","configure"]` 추가(+ `admin.settings:view` 존재 확인), 적절한 role에 매핑. 또는 카탈로그를 이미 seed된 action으로 변경(권장: 전자 — `configure`가 설정 도메인에 의미상 정확).
  - 카탈로그 default는 코드 보유(row는 override일 때만 생성) → 그 외 seed 변경 없음.
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

---

## 12. Codex 적대적 리뷰 반영 로그 (2026-06-18)

리뷰 14건(HIGH 4·MED 7·LOW 3). Finding 1·5는 실제 코드(`src/kernel/access/index.ts`, `src/lib/auth/permissions-client.tsx`, `prisma/seed.ts`)로 검증함.

| # | Sev | 판정 | 반영 위치 |
| --- | --- | --- | --- |
| 1 권한 API drift(단일 문자열 vs `(resource,action)`) | HIGH | 수용 | §4.1 `permission:{resource,action}`, §5.2, §5.8, §7.1·§7.3 |
| 2 client-shared 카탈로그 메타 누출 | HIGH | 수용 | §2.1 catalog server-only, §7.2 클라 최소검증, §9 |
| 3 admin route-level gate 부재 | HIGH | 수용 | §5.8 베이스 게이트, §7.3 |
| 4 secret status 토폴로지 누출 | HIGH | 수용 | §5.8 coarse status, §6 |
| 5 seed 권한 불일치(workflows configure 미존재) | MED | 수용(검증) | §4.2 주, §10 |
| 6 invalid→default 무음 fallback | MED | 수용 | §4.1 `fallbackSafe`, §5.1·§5.4, §8 |
| 7 audit redaction 과소분류 | MED | 수용 | §5.6 기본 summary, §4.2 calendarIds→summary |
| 8 concurrency 원자성 미정의 | MED | 수용 | §5.7 알고리즘 |
| 9 audit actor null 가능 | MED | 수용 | §5.2·§5.5 `SettingActorRequiredError` |
| 10 summary로 인가 판단 | MED | 수용 | §5.8 `hasPermission` per entry |
| 11 kernel 도메인 과적재 | MED | 부분 수용 | §2.1 registry/catalog 분리, §2.5 부채 명시(Phase 2는 kernel 유지 — 사용자 결정) |
| 12 relational kind 조기 | LOW | 유지+주의 | §1.2·§5.9(단일 엔트리, 링크 강등 가능) |
| 13 envVars filePath 과조립 | LOW | 수용 | §4.1 `envVars:{name,kind}[]` |
| 14 generic typed API 미정의 | LOW | 수용 | §4.1 `as const` 매핑 또는 parse 경계 |

**전체 평가(Codex)**: 방향은 타당하나 구현 준비는 아직 — 최대 블로커는 권한 API drift·클라이언트 카탈로그 노출·admin route gate 부재. 이 셋은 위에서 해소했고, 나머지는 구현 중 조이도록 반영.
