# Phase 2 — 설정 체계(Settings) 공통 기반

- **Goal:** 설정 파편화를 제거하고 secret/운영설정을 분리한 **typed settings registry + 검증·감사·일원화 + 설정 홈 UI**를 세운다. 실연결 프로브와 relational 편집기 CRUD는 Phase 4로 deferred.
- **Architecture:** `kernel/settings`에 registry(타입·service·repository·reader)와 Phase 2 카탈로그 조립 지점을 둔다. `SystemSetting`(key/value Json) 위에 Zod 타입 레이어. secret은 `lib/env`가 env/파일로만 관리(DB 미저장), 상태는 coarse하게 노출. read fail-safe(UI)/fail-closed(운영·write), write는 단일 트랜잭션에 감사 동반. 모듈은 `reader`(read-only)만 사용.
- **Tech Stack:** Next 16 App Router, TypeScript 5.9, Prisma 6.19(PostgreSQL, 스키마 무변경), zod 4, vitest, eslint 9 flat + boundaries. NextAuth v5 세션(Phase 1).
- **관련 문서:** [spec](../specs/2026-06-18-phase-2-settings-design.md), [access-control](../architecture/access-control.md), [Phase 1 plan](2026-06-17-phase-1-foundation.md)(SC-1 경계·SC-5 권한 API).

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-18-phase-2-settings/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts

모든 task가 이 절을 함께 읽는다. 공유 타입·상수·시그니처는 여기 한 번만 둔다. task 파일은 재인라인하지 말고 "entrypoint §Shared Contracts"를 가리킨다.

### SC-1. 디렉터리·경계 (Phase 1 SC-1 정합)

```text
src/kernel/settings/registry.ts   ← 순수 타입(SettingEntry 유니온·enum·에러). type-only, 도메인 무관.
src/kernel/settings/catalog.ts    ← server-only: Phase 2 구체 항목 조립 지점(as const).
src/kernel/settings/repository.ts ← server-only: prisma(SystemSetting + AuditLog, tx, concurrency).
src/kernel/settings/service.ts    ← server-only: getSetting/setSetting/listSettings.
src/kernel/settings/reader.ts     ← server-only: 모듈용 read-only facade(getSetting만 재노출).
src/kernel/settings/index.ts      ← app facade(service 재노출, reader 제외).
src/lib/env/schema.ts             ← process.env zod 스키마.
src/lib/env/index.ts              ← server-only: env(boot fail-fast) + getSecretStatus().
src/modules/integrations/status.ts, index.ts  ← 연동 상태(reader+env로 read-only, userId별 integrations.*:view 게이트).
src/app/(app)/admin/settings/*    ← 설정 홈/카드/편집기.
src/app/api/admin/settings/route.ts, [key]/route.ts  ← GET/PUT.
```

- 의존: `kernel/settings`→`kernel/*`(access·audit)+`lib/*`(prisma)만, 모듈 import 금지. `modules/integrations`→`kernel/settings/reader`+`lib/env`+`kernel/access`(`hasPermission`)만(`service`/`setSetting`/`catalog` import 금지). `app`→전부.
- `catalog.ts`·`repository.ts`·`service.ts`·`reader.ts`·`lib/env/index.ts`는 첫 줄 `import "server-only";`.

### SC-2. registry 타입·에러 (`src/kernel/settings/registry.ts`)

```ts
import type { ZodTypeAny } from "zod";
import type { Action } from "@/kernel/access";        // Phase 1 SC-5 재사용
import type { Prisma } from "@prisma/client";

export type JsonValue = Prisma.InputJsonValue;
export type SettingCategory = "security" | "integrations" | "workflows" | "general";
export type AuditMode = "full" | "redacted" | "summary";
export type SettingStatus = "OK" | "INVALID" | "configured" | "attention_required" | "LINK";

interface SettingEntryBase {
  key: string;                                         // 카탈로그 식별자(모든 kind 공통, 유일)
  category: SettingCategory;
  order: number;
  title: string;
  description: string;
  permission: { resource: string; action: Action };   // 단일 문자열 금지
}
export interface SystemSettingEntry extends SettingEntryBase {
  kind: "systemSetting";
  // key가 곧 SystemSetting.key(DB) = "<module>.<feature>.<setting>". 별도 settingKey 두지 않음.
  schema: ZodTypeAny;
  default: JsonValue;
  audit: AuditMode;
  fallbackSafe: boolean;
}
export interface RelationalSettingEntry extends SettingEntryBase {
  kind: "relational";
  model: string;                                       // dev 메타 — UI 분기 금지
  manageHref: string;
}
export interface EnvSecretEntry extends SettingEntryBase {
  kind: "envSecret";
  envVars: Array<{ name: string; kind: "value" | "filePath" }>;
}
export type SettingEntry = SystemSettingEntry | RelationalSettingEntry | EnvSecretEntry;

export class UnknownSettingError extends Error {}
export class SettingNotWritableError extends Error {}
export class SettingValidationError extends Error {}
export class SettingConcurrencyError extends Error {}
export class SettingInvalidError extends Error {}
export class SettingActorRequiredError extends Error {}
```

### SC-3. registry API (`service.ts` / `reader.ts` / `index.ts`)

```ts
// READ(운영): 미등록→UnknownSettingError; invalid&fallbackSafe→default+warn; invalid&!fallbackSafe→SettingInvalidError.
export function getSetting(key: string): Promise<unknown>;
// WRITE(fail-closed): allowlist(systemSetting만)·Zod·audit 동일 tx·concurrency·actorId 비-null.
export interface SetSettingCtx { actorId: string; expectedUpdatedAt?: Date | null; }
export function setSetting(key: string, value: unknown, ctx: SetSettingCtx): Promise<{ updatedAt: Date }>;
// UI 목록: admin 게이트 + 항목별 hasPermission 필터 + status merge. 절대 throw 안 함(항목 단위 fail-safe).
export interface SettingsCatalogItem {
  key: string;                       // settingKey | relational key | envSecret 식별자
  kind: SettingEntry["kind"];
  category: SettingCategory;
  order: number;
  title: string;
  description: string;
  status: SettingStatus;
  manageHref?: string;               // relational
  value?: unknown;                   // systemSetting만(현재 유효값/ default). secret 값 절대 없음
  updatedAt?: Date;                  // systemSetting concurrency 토큰
}
export function listSettings(userId: string): Promise<SettingsCatalogItem[]>;
// reader.ts: export { getSetting } from "./service";  (모듈 전용, write 미노출)
```

### SC-4. 카탈로그 (`catalog.ts`) — Phase 2 항목

정적 배열 `readonly SettingEntry[]`(**`as const` 금지** — 배열 default `[]`가 readonly가 되어 `Prisma.InputJsonValue` 할당이 깨진다). Phase 2는 `getSetting`이 `unknown` 반환(SC-3)이라 타입 매핑 불필요. 후속에 `as const`로 key→value 매핑 확장 가능. 모든 kind가 base `key`를 카탈로그 식별자로 가지며 systemSetting의 `key`는 `SystemSetting.key`(DB)와 동일.

| 식별자 / envVars | kind | category | permission(resource:action) | audit | fallbackSafe |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL`,`NEXTAUTH_SECRET` | envSecret | security | `admin.settings:view` | — | — |
| `GOOGLE_APPLICATION_CREDENTIALS`(filePath) | envSecret | integrations | `integrations.google:view` | — | — |
| `SMTP_PASSWORD` | envSecret | integrations | `integrations.smtp:view` | — | — |
| `LIBREOFFICE_PATH`(filePath) | envSecret | integrations | `integrations.templates:view` | — | — |
| `integrations.smtp.host` | systemSetting | integrations | `integrations.smtp:configure` | full | false |
| `integrations.smtp.port` | systemSetting | integrations | `integrations.smtp:configure` | full | false |
| `integrations.smtp.fromAddress` | systemSetting | integrations | `integrations.smtp:configure` | summary | false |
| `integrations.google.calendarIds` | systemSetting | integrations | `integrations.google:configure` | summary | false |
| `workflows.weeklyReport.defaultRecipients` | systemSetting | workflows | `workflows.weekly:configure` | summary | true |
| `workflows.billing.config` | relational(BillingConfig) | workflows | `workflows.billing:configure` | — | — |

Zod 스키마(초안): host=`z.string()`, port=`z.coerce.number().int().min(1).max(65535)`, fromAddress=`z.string().email().or(z.literal(""))`, calendarIds=`z.array(z.string().min(1))`, defaultRecipients=`z.array(z.string().email())`. default: host=`""`, port=`587`, fromAddress=`""`, calendarIds=`[]`, defaultRecipients=`[]`. (빈 문자열="미설정"으로 schema 통과 → "default valid" 불변식 유지; 완성도는 integrations 상태가 length>0로 판정.)

### SC-5. env 계약 (`lib/env`)

```ts
// schema.ts
export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXTAUTH_SECRET: z.string().min(1),
  SMTP_PASSWORD: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  LIBREOFFICE_PATH: z.string().optional(),
  TEMPLATE_DIR: z.string().optional(),
  OUTPUT_DIR: z.string().optional(),
});
// index.ts  (lib→lib만 허용 → 카탈로그를 import하지 않는다. 호출자가 spec을 넘긴다)
export const env: z.infer<typeof envSchema>;             // import 시 parse, required 실패→throw(boot)
export type SecretHealth = "configured" | "attention_required";
export type SecretVar = { name: string; kind: "value" | "filePath" };
export interface SecretStatus { id: string; health: SecretHealth; }  // 값·변수명·경로 미포함
// 각 spec의 모든 var가 present/valid면 configured, 아니면 attention_required. filePath는 fs.existsSync.
export function getSecretStatus(specs: Array<{ id: string; vars: SecretVar[] }>): SecretStatus[];
```

### SC-6. 감사 계약

- `setSetting` write는 `prisma.$transaction([upsert SystemSetting, create AuditLog])` 단일 트랜잭션.
- AuditLog: `entityType="SystemSetting"`, `entityId=key`, `action="settings.update"`, `actorId=ctx.actorId`(비-null 강제), `metadata`=redaction(SC: full/redacted/summary, 기본 summary).
- redaction 헬퍼 `redactForAudit(mode, before, after)`: summary=배열 길이+`changed`(before≠after) / 객체 키 목록; redacted=`{changed:true}`; full=원값. **summary에 역추적 가능한 결정적 해시 금지**(Codex 2차 리뷰 F2).

### SC-7. 권한/seed 계약

- 인가는 **`hasPermission(userId, resource, action)`**(Phase 1 SC-5) — summary로 판단 금지.
- API 게이트: GET=`requirePermission(uid,"admin.settings","view")`; PUT=`requirePermission(uid,"admin.settings","configure")` **그리고** `requirePermission(uid, entry.permission.resource, entry.permission.action)`. PUT body는 `expectedUpdatedAt`(null|ISO) **필수** — 생략·형식오류 400(동시성 토큰 우회 차단, Codex 2차 F3).
- **seed 보강 필요(검증됨)**: `prisma/seed.ts`의 `EXTRA_PERMISSIONS`에 현재 `workflows.weekly:configure`·`workflows.billing:configure` 없음 → 추가. `admin.settings:view`는 base seed 존재 확인(catalog RESOURCES 기반). 적절 role 매핑.

### SC-8. 검증 명령

- `npm run prisma:validate` — 스키마(무변경) 검증.
- `npm run typecheck` / `npm run lint` / `npm test`(vitest).
- DB 필요(repository/service/seed): 로컬 PostgreSQL(`DATABASE_URL`). 환경은 `workspace-env/INVENTORY.md`.

---

## Tasks

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | registry 타입·에러 + 카탈로그 조립(as const) + 정합성 테스트 | [ ] | [task-01](2026-06-18-phase-2-settings/task-01-registry-and-catalog.md) | — | |
| 02 | lib/env: env Zod(boot fail-fast) + getSecretStatus(coarse) | [ ] | [task-02](2026-06-18-phase-2-settings/task-02-env-validation.md) | — | |
| 03 | repository: read raw + write-with-audit tx + concurrency | [ ] | [task-03](2026-06-18-phase-2-settings/task-03-repository.md) | 01 | |
| 04 | service + reader + index: getSetting/setSetting/listSettings + redaction | [ ] | [task-04](2026-06-18-phase-2-settings/task-04-service.md) | 01, 02, 03 | |
| 05 | seed 보강: workflows configure 권한 + role 매핑 | [ ] | [task-05](2026-06-18-phase-2-settings/task-05-seed-permissions.md) | 01 | |
| 06 | modules/integrations 상태 모듈(read-only) | [ ] | [task-06](2026-06-18-phase-2-settings/task-06-integrations-status.md) | 02, 04 | |
| 07 | API 라우트: GET/PUT + admin·엔트리 게이트 | [ ] | [task-07](2026-06-18-phase-2-settings/task-07-api-routes.md) | 01, 04 | |
| 08 | UI: 설정 홈 + 카테고리 섹션 + 상태 카드 + systemSetting 편집기 | [ ] | [task-08](2026-06-18-phase-2-settings/task-08-settings-ui.md) | 04, 06, 07 | |
| 09 | 경계 가드: modules→reader lint + server-only·직접 write 금지 테스트 | [ ] | [task-09](2026-06-18-phase-2-settings/task-09-boundary-guards.md) | 04, 06 | |

실행 순서 권장: 01 → 02 → 03 → 04 → (05·06·07 병렬 가능) → 08 → 09.
