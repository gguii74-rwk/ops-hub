# 설정 페이지 재구성 + 연동 설정 진실화 (PR-A) — 구현 계획

- **Feature**: 설정 화면(`/admin/settings`) IA 재편 + SMTP 설정 DB 진실화 + 편집기 타입 분기.
- **Goal**: 죽은 SMTP DB 설정을 실제 전송 경로에 배선하고(port/from), 상태 표시를 전송 동작과 일치시키며, 설정 화면을 영역(group)별 카드로 재편한다.
- **Architecture**: 카탈로그에 표시 그룹 메타를 추가하고, 메일 전송 config 타입을 lib에 두어 kernel 해석기(`getSmtpConfig`)가 채택(경계 안전). 호출자(leave·workflows)가 해석한 config를 `sendMail`에 주입. 상태 점검은 전송 auth 분기와 동일 규칙. UI는 값 타입별 편집기로 분기.
- **Tech Stack**: Next.js App Router, Prisma(PostgreSQL), zod, nodemailer, vitest, eslint-plugin-boundaries.
- **Scope**: **PR-A 전용**. Google 전환(calendarIds→relational, seed cutover, 소스 CRUD)은 전부 **PR-B**(별도 plan·세션). 본 PR은 `integrations.google.calendarIds`를 `systemSetting`(string[])로 그대로 두고 리스트 편집기 UI만 입힌다.
- **SSOT**: 설계 결정·적대검증 판정은 `docs/specs/2026-06-26-settings-redesign-design.md`(D1~D10, F1~F13). 본 plan은 그 spec의 PR-A 구현 절차다.

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-26-settings-redesign/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts

2개 이상 task가 참조하는 타입·시그니처·상수. task 파일은 이 섹션을 가리키고 재인라인하지 않는다.

### SC-1. `MailTransportConfig` (lib 소유 — D3, F1)

전송 config 타입은 **메일 lib**에 정의한다. eslint boundaries상 `lib`는 `lib`만 import 가능하므로, lib이 kernel 타입을 import하면 경계 위반(F1). 따라서 타입을 lib에 두고 kernel이 이를 **채택**한다(kernel→lib import는 허용).

```ts
// src/lib/integrations/mail/index.ts
export interface MailTransportConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
}
```
- **비밀번호는 이 타입에 없다** — `sendMail`이 `process.env.SMTP_PASSWORD`에서 직접 읽는다(D2: secret은 config로 흐르지 않음).

### SC-2. `getSmtpConfig()` (kernel 해석기 — D1·D2·D10, F2·F7)

```ts
// src/kernel/settings/service.ts (정의) → src/kernel/settings/reader.ts (re-export)
import type { MailTransportConfig } from "@/lib/integrations/mail";
export async function getSmtpConfig(): Promise<MailTransportConfig>;
```
필드별 출처(절대 throw하지 않음, D10):
- `host`:   `env SMTP_HOST` (없으면 `""`) — **env 전용**(D2·F4)
- `user`:   `env SMTP_USER` (없으면 `""`) — **env 전용**(D2·F4)
- `secure`: `env SMTP_SECURE === "true"` — **env 전용**(D2·F4)
- `port`:   **`readRaw` 행 존재+유효 → DB**, 행 부재/빈값/무효 → `Number(env SMTP_PORT)` → `587` (F7: `getSetting` 금지 — 행 부재 시 default 587이 비-587 env를 가린다)
- `from`:   **`readRaw` 행 존재+비어있지 않은 유효 → DB**, 아니면 `env SMTP_FROM` → `env SMTP_USER` → `"noreply@uracle.co.kr"`

모듈은 `@/kernel/settings/reader`로만 settings를 import한다(no-restricted-imports). 따라서 `getSmtpConfig`는 reader에서 re-export 필수.

### SC-3. `sendMail` 시그니처 확장 (D3)

```ts
// src/lib/integrations/mail/index.ts
export async function sendMail(msg: MailMessage, config?: MailTransportConfig): Promise<SendResult>;
```
- `config` 주입 시: `host/port/secure/user`를 config에서, `pass`는 `process.env.SMTP_PASSWORD`, `from`은 `config.from`.
- `config` 미주입 시: **현행 env-only 동작 완전 보존**(테스트는 `setMailTransportForTests`로 우회 → 무영향).
- 호출자: `const cfg = await getSmtpConfig(); await sendMail(msg, cfg);` (모듈→kernel·모듈→lib 모두 boundary 허용).

### SC-4. 표시 그룹 (D7) — `SettingGroup` + 배정

```ts
// src/kernel/settings/registry.ts (SettingEntryBase에 추가)
export type SettingGroup = "security" | "mail" | "google" | "documents" | "leave" | "workflows";
// SettingEntryBase:
group: SettingGroup;
groupOrder: number; // 그룹 내 표시 순서
```
`category`(기존 coarse 분류)는 **보존**하고, 화면 렌더링만 `group`+`groupOrder`로 한다. 그룹 표시 순서(페이지 상수): `security → mail → google → documents → leave → workflows`.

| key | group | groupOrder |
| --- | --- | --- |
| `secret.database` | security | 1 |
| `secret.auth` | security | 2 |
| `secret.smtp` | mail | 1 |
| `integrations.smtp.port` | mail | 2 |
| `integrations.smtp.fromAddress` | mail | 3 |
| `secret.google` | google | 1 |
| `integrations.google.calendarIds` | google | 2 |
| `secret.libreoffice` | documents | 1 |
| `leave.notifications.onRequest` | leave | 1 |
| `leave.notifications.onApprove` | leave | 2 |
| `leave.notifications.onReject` | leave | 3 |
| `workflows.weeklyReport.defaultRecipients` | workflows | 1 |
| `workflows.billing.config` | workflows | 2 |

- **`integrations.smtp.host` 카탈로그 엔트리 제거**(env 전용, F4). orphaned DB row는 무해(getEntry undefined → 미표시·미쓰기).
- `secure`/`user`는 **DB에 추가하지 않는다**(env 전용).
- 그룹 헤더 배지 매핑: `mail→smtp`, `google→google`, `documents→templates` 연동 상태. `security`/`leave`/`workflows`는 그룹 헤더 배지 없음(항목별 배지/편집기).

### SC-5. `SettingStatus`에 `"not_required"` 추가 (F12)

```ts
// src/kernel/settings/registry.ts
export type SettingStatus = "OK" | "INVALID" | "configured" | "attention_required" | "LINK" | "not_required";
```
`secret.smtp` 항목 행 상태를 전송 auth 분기와 일치시킨다: `SMTP_USER` 미설정(무인증 릴레이)이면 비밀번호 불필요 → `"not_required"`(중립 "인증 미사용"). `SMTP_USER` 설정 시에만 `SMTP_PASSWORD` 존재로 `configured`/`attention_required` 판정.

### SC-6. 상태 점검 규칙 (D5, F9) — `smtpConfigured`

전송 auth 분기(`SMTP_USER ? {user,pass} : undefined`)와 정확히 일치:
```
configured = cfg.host.length > 0 AND (cfg.user.length === 0 || SMTP_PASSWORD 존재)
```
`getSmtpConfig`가 tolerant(throw 없음)이므로 smtp는 `safe()` 래핑 **불필요**(unknown 미발생). google·templates는 현행 유지(google은 `safe()`/`unknown` 3-state 유지).

### SC-7. 경계 규칙 요약 (`eslint.config.mjs`)

- `lib` → `lib`만. (메일 lib은 kernel import 금지 → `MailTransportConfig`는 lib 자기 타입.)
- `kernel` → `kernel`,`lib`. (service.ts가 lib의 `MailTransportConfig`를 `import type`으로 채택 가능.)
- `module` → `kernel`,`lib`,동일 module. + 모듈은 settings를 **`@/kernel/settings/reader`로만** import(no-restricted-imports).

---

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 카탈로그 IA: group 필드 + SMTP host 제거 | [ ] | [task-01](2026-06-26-settings-redesign/task-01-catalog-ia.md) | — | |
| 02 | 메일 lib: MailTransportConfig + sendMail(config?) | [ ] | [task-02](2026-06-26-settings-redesign/task-02-mail-lib-config.md) | — | |
| 03 | kernel getSmtpConfig 해석기 + reader re-export | [ ] | [task-03](2026-06-26-settings-redesign/task-03-smtp-resolver.md) | 02 | |
| 04 | 메일 호출자 배선(leave·workflows) | [ ] | [task-04](2026-06-26-settings-redesign/task-04-wire-callers.md) | 02, 03 | |
| 05 | 상태 진실화: smtpConfigured auth 분기 + secret.smtp 행 | [ ] | [task-05](2026-06-26-settings-redesign/task-05-status-truthing.md) | 03 | |
| 06 | 설정 편집기: String/Number/List 분기 | [ ] | [task-06](2026-06-26-settings-redesign/task-06-editors.md) | — | |
| 07 | 설정 페이지 IA: 그룹 카드 + 헤더 배지 | [ ] | [task-07](2026-06-26-settings-redesign/task-07-page-ia.md) | 01, 05, 06 | |

**실행 순서 권장**: 01·02·06은 서로 독립(병렬 가능). 03→04, 03→05는 순차. 07은 마지막(01·05·06 의존). 전 task는 마이그레이션·seed·권한 catalog 무변경(D9) → 표준 restart 배포.

## Definition of Done (PR-A 전체)

- `npm run lint` / `npm run typecheck` / `npm test` / `npm run build` 모두 green.
- 기존 스위트 회귀 없음(현재 1380 통과 기준 — host 제거·편집기 분기로 수정되는 기존 테스트는 각 task가 갱신).
- §7 회귀 테스트(F2 무회귀·F7 비-587 env·F9 auth 분기·F12 행/헤더 일관성) 포함.
- smoke(배포 후): 인증 → `/admin/settings` 영역 카드·상태 배지 렌더, SMTP port/from 저장 → 메일 1건 발송, advisory 라우트 회귀(stale-build P2010 주의).
