# 워크플로 메일 수신자 세트(주소록 + 타입×단계 기본값) — 구현 계획 (엔트리포인트)

- Feature: 메일 발송을 **to/참조(cc)/숨은참조(bcc)** 로 확장하고, **주소록 `MailContact`** 와 **업무유형×발송단계 기본 수신자 세트**(`WorkflowType.defaultRecipients` 구조화)를 설정에서 관리한다. 발송 모달 3필드 + 주소록 이름 힌트, 死설정 정리(weeklyReport 수신자 catalog·billing manageHref) 포함.
- Goal: 발송 수신자를 cc/bcc까지 관리·기록하고(기록=실제 전송 envelope), 타입×단계 기본 세트가 발송 모달에 prefill되며, 주소가 늘어도 주소록으로 "누구인지" 파악할 수 있다.
- Architecture: Route Handler → Service → Repository → Prisma. 정규화(D10)는 mail lib 단일 소유(`normalizeEnvelope`) — `deliver`가 **기록 전** 적용. 관리 게이트 = `admin.settings:configure` ∧ `workflows.mail:configure` 교집합(D6, 읽기·쓰기 동일). 편집 가능 kind×step은 `SEND_STEP_TRANSITION` 파생 단일 출처(D7 — 현재 BILLING "1"·"2").
- Tech Stack: Next.js App Router, Prisma(PostgreSQL multiSchema), React Query, vitest + testing-library, zod v4.
- Spec(SSOT): `docs/specs/2026-07-02-workflows-mail-recipients-design.md` (D1~D15, 적대검증 2R 종결). 사용자 기결정(Q1~Q4) 재논의 금지.

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-07-02-workflows-mail-recipients/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts (2+ 태스크가 참조 — 여기 1회만 정의)

### SC-1. 스키마 (additive 2건, D13) — `prisma/schema.prisma` + `prisma/migrations/20260702000000_mail_recipients/`

```prisma
model MailContact {
  id        String   @id @default(cuid())
  email     String   @unique            // trim + 소문자 정규화 저장(D2)
  name      String
  memo      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@schema("workflows")
}
// MailDelivery에 추가(additive, D4). 기존 recipients = to 의미 보존:
//   cc  Json?
//   bcc Json?
```

`WorkflowTask.recipients`·`WorkflowType.defaultRecipients` 컬럼은 **불변**(D5 — 보존, drop 금지).

### SC-2. 수신자 타입·파서 — `src/modules/workflows/recipients.ts` (신규 순수 모듈, server-only 금지 — 클라 타입 import)

```ts
export interface RecipientFields { to: string[]; cc: string[]; bcc: string[] }
export type DefaultRecipientsMap = Record<string, RecipientFields>;           // 키 = step("1","2",…) — D3 구조
export interface RecipientEntry { email: string; name?: string }              // D8 enrich 항목
export interface EffectiveRecipientFields { to: RecipientEntry[]; cc: RecipientEntry[]; bcc: RecipientEntry[] }
export type EffectiveRecipientsMap = Record<string, EffectiveRecipientFields>;
export function parseDefaultRecipients(json: unknown): DefaultRecipientsMap | null; // 비객체/배열(flat legacy) → null. step 값이 비객체면 skip, 필드 누락 → []
export function normalizeStoredEmails(list: string[]): string[];              // 세트 저장용: trim → 빈 제거 → 소문자 → 순서보존 dedup(§3)
```

### SC-3. 정책 파생 (D7) — `src/modules/workflows/policy.ts`

```ts
export function sendStepsForKind(kind: WorkflowKind): string[];   // SEND_STEP_TRANSITION[kind]의 키 — BILLING → ["1","2"], 그 외 []
export function mailRecipientKinds(): WorkflowKind[];             // step이 1개 이상인 kind — 현재 ["BILLING"]
```

### SC-4. mail lib envelope (D10) — `src/lib/integrations/mail/index.ts`

```ts
export interface MailMessage { to: string[]; cc?: string[]; bcc?: string[]; subject: string; html: string; attachments?: MailAttachment[]; }
export interface MailTransport {
  sendMail(opts: { from: string; to: string; cc?: string; bcc?: string; subject: string; html: string; attachments?: MailAttachment[] }): Promise<{ messageId?: string }>;
}
export interface MailEnvelope { to: string[]; cc: string[]; bcc: string[] }
export function normalizeEnvelope(input: { to: string[]; cc?: string[]; bcc?: string[] }): MailEnvelope;
// 필드별 trim·빈 제거·대소문자 무시 dedup(첫 표기 보존) + 교차 제외: cc−to, bcc−(to∪cc). 멱등.
// to 빈 결과 허용(throw는 소비자 몫): sendMail은 to 비면 throw(기존), deliver는 ConflictError, cc/bcc 빈은 헤더 생략.
```

### SC-5. 발송 기록 계약 (D4·D10) — `repositories/mail.ts` · `services/mail.ts`

- `createSendingDelivery` args += `cc?: string[]; bcc?: string[]`(미지정 → `[]` 기록 — 기존 테스트·leave 호출 호환).
- `deliver`: `normalizeEnvelope` 적용 → `env.to` 비면 `ConflictError`(기록 전) → 기록 `recipients=env.to, cc=env.cc, bcc=env.bcc` → `sendMail`에 동일 envelope. **기록 = 실제 전송 envelope**.
- `DeliveryForAction` += `cc: string[]; bcc: string[]`(null → `[]`). `retryDelivery`는 저장된 `recipients+cc+bcc` 그대로 재발송.

### SC-6. runSend 해석 체인 (D5) — `services/send.ts` · `[id]/send/route.ts`

- 입력: `{ step, subject, body, recipients?, cc?, bcc? }`. 해석: `input.recipients`가 **존재하면**(`!== undefined` — `[]` 포함) **입력 envelope 그대로**(`cc/bcc` 기본 `[]`) — `[]`는 "비운 명시 입력"이라 to 빈 거부(**defaults 폴백 금지** — 의도치 않은 기본 수신자 발송 차단). **생략(undefined) 시에만** `type.defaultRecipients[String(step)]`의 `{to,cc,bcc}` 폴백 → 최종 to 비면 `ConflictError`. **`task.recipients` 미참조**(死필드 — 컬럼 보존).
- `TaskForSend`: `recipients` 필드 제거, `defaultRecipients: DefaultRecipientsMap | null`(`parseDefaultRecipients`).
- route zod: `cc: z.array(z.string().email()).optional(), bcc: z.array(z.string().email()).optional()` 추가.

### SC-7. 상세 API 계약 (D8·D14) — `services/tasks.ts` · `repositories/index.ts`

```ts
export interface MailView { id: string; step: string | null; recipients: string[]; cc: string[]; bcc?: string[]; subject: string; status: MailDeliveryStatus; errorMessage: string | null; sentAt: string | null; }
// bcc: `<kind>:send` 권한자 응답에만 필드 포함(D14). cc는 view 허용(null → []).
export interface TaskDetailView { …; effectiveRecipients?: EffectiveRecipientsMap; }
// effectiveRecipients: :send 권한자만. sendStepsForKind(kind)의 각 step에 대해 type.defaultRecipients[step](없으면 빈 필드)을
// findContactNamesByEmails(등장 email만 — 주소록 전체 미노출)로 enrich한 단계별 맵. 기존 flat string[] 구조는 폐기(소비처 동시 교체).
```

`MailRow` += `cc: unknown; bcc: unknown`. `TaskDetailRow`: `recipients` 제거, `defaultRecipients: DefaultRecipientsMap | null`.

### SC-8. 관리 API 표면 (D6·D7·D15)

- 게이트(서비스 소유, 페이지·API 공유 — 접근제어 규칙①): `services/mail-recipients.ts`의
  `canManageMailRecipients(userId): Promise<boolean>` = `hasPermission(admin.settings, configure) && hasPermission(workflows.mail, configure)`.
- 라우트(전부 401 → 403 게이트 → zod 400): `GET/POST /api/workflows/mail/contacts`, `PATCH/DELETE /api/workflows/mail/contacts/[id]`(PATCH=name·memo만, email 포함 body 400 — D15), `GET /api/workflows/mail/recipients`, `PUT /api/workflows/mail/recipients/[kind]`(kind∉`mailRecipientKinds()` 400, **step 키 집합 = `sendStepsForKind(kind)` 정확 일치 — 누락·초과 모두 400**: 전체 교체 계약에서 부분 body가 다른 단계 세트를 지우지 못하게).
- validations(`validations/index.ts`): `mailContactCreateSchema`(email trim+email·name min1·memo≤500 optional), `mailContactUpdateSchema`(**strictObject** name·memo — D15), `recipientSetPutSchema` = `z.record(z.string(), recipientFieldsSchema)`(각 필드 email 배열).
- 서비스(`services/mail-recipients.ts`): `listMailContacts()`, `addMailContact({email,name,memo?})`(email trim+소문자, P2002→ConflictError→409), `editMailContact(id,{name,memo?})`(없으면 null→404), `removeMailContact(id)`, `getRecipientSets(): RecipientSetView[]`(`{kind, steps, recipients}` — 미저장 step은 빈 필드), `saveRecipientSet(kind, map)`(필드별 `normalizeStoredEmails` 후 전체 교체, type 행 없으면 null→404).
- 레포(`repositories/mail-recipients.ts`): `listContacts`, `createContact`, `updateContactNameMemo`, `deleteContactById`, `findContactNamesByEmails(emails): Map<소문자 email, name>`, `findDefaultRecipientsByKind`, `updateDefaultRecipientsByKind`.

### SC-9. 설정 카탈로그 (D9·⑦) — `src/kernel/settings/catalog.ts`

- **제거**: `workflows.weeklyReport.defaultRecipients`(死설정) + `settings-editor.tsx`의 email 특례(`EMAIL_RE`·`requireEmail`).
- **수정**: `workflows.billing.config`의 `manageHref` → `/workflows/billing/settings`(현재 `/admin/settings/billing`은 깨진 링크).
- **추가**(relational): key `workflows.mail.recipients`, category/group `workflows`, groupOrder 1, order 40, title "메일 수신자", permission `{ resource: "workflows.mail", action: "configure" }`, model `MailContact`, manageHref `/admin/settings/mail-recipients`.
- 결과 카탈로그: systemSetting 5 · envSecret 5 · relational 2 · 총 12.

### SC-10. 권한·시드 (D11)

- `RESOURCES`(access catalog) += `"workflows.mail"`(monthlyClient 뒤). seed가 `workflows.mail:view`도 자동 생성(무해 — 매트릭스 노출용).
- `EXTRA_PERMISSIONS`(seed-permissions.ts) += `["workflows.mail", "configure"]`. fresh install pm은 `"*"`로 자동 보유.
- 기존 DB reconcile: `prisma/migrate-helpers/workflows-mail-configure-upgrade.ts`의 `applyWorkflowsMailConfigureUpgrade`(billing-create 선례) — flag `migration.workflows-mail-configure.upgrade.applied`, 대상 **pm만** ALLOW/all. `seed.ts` 3f-2 직후 배선(3f-3).

### SC-11. UI 계약

- 발송 모달 prop: `effectiveRecipients?: EffectiveRecipientFields`(부모 `workflow-detail`이 `detail.effectiveRecipients?.[String(step)]` 전달). 3필드(수신자/참조/숨은참조, 쉼표 구분) prefill = 각 필드 email join. 이름 힌트 = name 있는 항목만 `email = name` 나열. 제출 payload = `{ step, subject, body, recipients, cc, bcc }` **항상 명시**(D6 원칙), to 비면 클라 차단(기존).
- 관리 페이지: `/admin/settings/mail-recipients`(서버 게이트 = `canManageMailRecipients`, 불충족 redirect `/admin/settings`). 주소록 섹션(테이블+추가+수정 모달[email 표시 전용 — D15]+삭제 2-click) + 세트 섹션(kind 카드 × step별 3필드, email 칩에 이름 배지 or "주소록 미등록" — D12).

---

## Task 목록

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 기반 — 스키마·마이그레이션·수신자 타입·정책 파생 | [ ] | [task-01](2026-07-02-workflows-mail-recipients/task-01-foundation.md) | — | |
| 02 | mail lib — normalizeEnvelope(D10)·cc/bcc 전달 | [ ] | [task-02](2026-07-02-workflows-mail-recipients/task-02-mail-lib.md) | — | |
| 03 | 발송 기록 — deliver 정규화·cc/bcc 기록·retry 재발송 | [ ] | [task-03](2026-07-02-workflows-mail-recipients/task-03-delivery-record.md) | 01, 02 | |
| 04 | runSend 체인 개정(D5) + send 라우트 cc/bcc | [ ] | [task-04](2026-07-02-workflows-mail-recipients/task-04-run-send.md) | 01, 02, 03 | |
| 05 | 권한 신설·시드 reconcile(D11) | [ ] | [task-05](2026-07-02-workflows-mail-recipients/task-05-seed-permission.md) | — | |
| 06 | 주소록·세트 관리 API(D6·D7·D15) | [ ] | [task-06](2026-07-02-workflows-mail-recipients/task-06-manage-api.md) | 01 | |
| 07 | 상세 API — MailView cc/bcc·bcc 게이트(D14)·effectiveRecipients 맵(D8) | [ ] | [task-07](2026-07-02-workflows-mail-recipients/task-07-detail-api.md) | 01, 03, 06 | |
| 08 | 발송 모달 3필드 + 상세 UI cc/bcc 표시 | [ ] | [task-08](2026-07-02-workflows-mail-recipients/task-08-send-modal-ui.md) | 04, 07 | |
| 09 | 설정 카탈로그 정리·진입(⑦·D9) | [ ] | [task-09](2026-07-02-workflows-mail-recipients/task-09-settings-catalog.md) | 05 | |
| 10 | 관리 페이지 /admin/settings/mail-recipients | [ ] | [task-10](2026-07-02-workflows-mail-recipients/task-10-manage-page.md) | 06, 09 | |

실행 순서 권장: 01 → (02, 05 병렬) → 03 → 04 → 06 → 07 → 08 → 09 → 10.

## 배포 (요약 — 상세는 task-05 §배포)

표준 restart(D13): `prisma migrate deploy`(additive 2건) → `npm run prisma:generate` → `db:seed`(신설 권한·pm reconcile) → build → `pm2 restart ops-hub`.

**preflight(§7 — multiSchema라 스키마 한정 필수, fail-fast)**: ① `workflows."WorkflowTask"."recipients"`·`workflows."WorkflowType"."defaultRecipients"` **non-null 행 0 증명**(D5 전제 — non-null이면 배포 중단, 값을 D3 구조로 이관/폐기 판단) ② `kernel."SystemSetting"`의 `workflows.weeklyReport.defaultRecipients` 값 확인(비어있지 않으면 수동 이관 판단). smoke: `/admin/settings/mail-recipients` 게이트(pm 200·비권한 redirect), `/api/workflows/mail/contacts` 401/403, 발송 모달 3필드 prefill, 기존 상세 이력 렌더.

## Plan 적대검증 ledger (plan 단계)

| # | round | sev | finding (fingerprint) | disposition |
|---|---|---|---|---|
| 1 | R1 | high | task-06 `PUT recipients/[kind]`가 누락 step을 미검사 — 부분 body(`{"1":…}`·`{}`)가 전체 교체로 내려가 다른 단계 세트를 조용히 삭제 | **FIXED** — 라우트가 step 키 집합 = `sendStepsForKind(kind)` **정확 일치** 강제(누락·초과 400) + 부분 body 400 테스트. SC-8·task-06 반영 |
| 2 | R1 | medium | 수신자 세트 저장이 LWW(버전/`expectedUpdatedAt` 없음) — 동시 편집 시 마지막 저장이 앞선 변경을 조용히 덮어씀 | **ACCEPTED** — ① 세트는 발송 모달 prefill **기본값**일 뿐, 실제 발송은 항상 모달 명시 envelope(D6)라 stale 세트가 곧바로 오발송이 되지 않음 ② 편집 주체 = D6 교집합 권한자(pm·OWNER 소수) ③ billing config 등 기존 도메인 관리 화면과 동일한 LWW 관례. 보완: 운영에서 충돌이 실증되면 후속으로 `WorkflowType.updatedAt` 낙관적 잠금 도입. (R2 재지목 = DUPLICATE) |
| 3 | R2 | high | task-04 runSend 입력 판단이 `?.length` — `recipients: []`(비운 명시 입력, `[] + cc` 포함)가 defaults로 폴백해 의도치 않은 기본 수신자 발송 | **FIXED** — 입력 여부 = 존재(`!== undefined`) 기준으로 개정: `[]`는 to 빈 거부(폴백 금지), 생략 시에만 type[step] 폴백. SC-6·task-04(구현·테스트 2케이스·Caution) 반영 |
