# 대금청구(Billing) 백엔드 구현 계획

- Date: 2026-06-29
- Spec(SSOT): `docs/specs/2026-06-29-workflows-billing-backend-design.md` (결정 D1~D13, 적대검증 ledger R1~R5 §14)
- Goal: day-sync 대금청구(설정 CRUD → HWPX 4종 생성 → 1·2단계 메일 발송 → 다운로드)를 ops-hub `modules/workflows` 백엔드로 포팅한다. UI·3단계(FINAL_SENT)·주간보고/알림톡 생성기는 비포함(spec §1 비포함).
- Architecture: Next.js App Router 모듈형 모놀리스. `Route Handler → Service → Repository → Prisma` 계층을 계승하고, 공통 기반(전이 엔진·메일 인프라·`GeneratorPort` 계약·`MailDelivery`)은 이미 머지돼 있다. 본 계획은 그 위에 **파일 저장소 계층 + 설정 CRUD + HWPX 생성기 + generate/send/다운로드 오케스트레이션**을 얹는다.
- Tech Stack: TypeScript, Next.js 16(App Router), Prisma(PostgreSQL multiSchema), Zod 4, JSZip(설치됨), vitest(node 환경), nodemailer.

## J1 확정 (spec §14 DEFERRED_TO_IMPL → 본 plan에서 확정)

generate 직렬화 primitive = **lease 컬럼 방식**(별도 `GenerationLock` 테이블 + Prisma-native CAS). advisory-lock-on-dedicated-connection은 기각(Prisma 풀이 커넥션 pinning을 보장하지 않아 전용 `pg` 커넥션 계층이 필요 → 복잡·새 의존성).

- 이 결정으로 spec D4의 "스키마 변경 **없음**"은 "**비파괴 추가 1개**(`GenerationLock` 테이블)"로 완화된다. 컬럼/테이블 추가는 비파괴이므로 **표준 restart**(full-stop 불필요)는 그대로 유지된다.
- lease는 FS 생성 동안 DB 커넥션/트랜잭션을 점유하지 않으므로 spec I2를 자연히 충족한다. crash 복구는 `lockedUntil` 만료 기반 steal(§Shared Contracts).

---

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-29-workflows-billing-backend/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts

2개 이상의 task가 참조하는 스키마·타입·시그니처·규약. task 파일은 이 섹션을 가리키고 재인용하지 않는다.

### SC-1. 파일 저장소 레이아웃·DB 경로 규약 (D2·D3)

```
$STORAGE_ROOT/
  Template/대금청구/…(02월).hwpx      # git 비추적. 배포 시 서버 배치, 테스트는 tmp fixture
  out/
    workflows/<taskId>/               # 산출물 (taskId 기반, D3)
    workflows/.tmp/<taskId>-<reqId>/  # generate 요청별 임시 디렉터리 (승격 전)
    workflows/.trash/<uniq>/          # 승격 시 기존 final 원자 교체용
```

DB에는 **storage-relative POSIX 경로만** 저장한다(절대경로·드라이브·`..` 금지):

| 컬럼 | 저장값 예시 |
| --- | --- |
| `WorkflowType.templatePath` | `Template/대금청구` |
| `WorkflowTask.outputPath` | `out/workflows/<taskId>` (디렉터리 포인터) |
| `GeneratedFile.path` | `out/workflows/<taskId>/(공문)….hwpx` |
| `MailDelivery.attachmentPaths` | `["out/workflows/<taskId>/(공문)….hwpx", …]` |

### SC-2. `src/lib/storage/index.ts` 헬퍼 시그니처 (task-01에서 구현, 다수 task가 소비)

```ts
export function getStorageRoot(): string;        // STORAGE_ROOT(절대경로). 미설정/상대면 throw(fail-closed)
export function getTemplateRoot(): string;        // <root>/Template
export function getOutputRoot(): string;          // <root>/out
export function resolveStoragePath(stored: string): string;   // STRICT: "Template/…"|"out/…" 상대만 → 절대경로. 절대·..·prefix불일치 throw
export function resolveTemplatePath(rel: string): string;     // "대금청구/…" → 절대경로(strict 기반)
export function resolveOutputPath(rel: string): string;       // "workflows/<id>/…" → 절대경로(strict 기반)
export function toStoredOutputPath(abs: string): string;      // <root>/out 하위 절대경로 → "out/…" 상대. 하위 아니면 throw(I4)
```

규칙(F4·I4): 모든 경로가 strict. legacy 절대경로 통과 경로는 **존재하지 않는다**. `resolveStoragePath`는 `stored`가 `Template/` 또는 `out/`로 시작할 때만 `path.resolve(getStorageRoot(), stored)`하고 결과가 root 하위(`resolved === root || resolved.startsWith(root + path.sep)`)인지 재검사한다. 위반 시 throw.

### SC-3. `GenerationLock` 모델 (task-07에서 신설 — J1 lease)

```prisma
model GenerationLock {
  taskId      String   @id
  holder      String   // 요청별 식별자(reqId = crypto.randomUUID())
  lockedUntil DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@schema("workflows")
}
```

lease 계약(task-07 repo 함수):

- `acquireGenerationLease(taskId, holder, ttlMs): Promise<boolean>` — `INSERT … ON CONFLICT (taskId) DO UPDATE SET holder, lockedUntil WHERE GenerationLock.lockedUntil < now()`의 affected-rows가 1이면 `true`(점유), 0이면 `false`(타인 보유 → 호출부가 409). `lockedUntil = now + ttlMs`.
- `releaseGenerationLease(taskId, holder): Promise<void>` — `DELETE WHERE taskId AND holder=holder`. holder 불일치(steal됨)면 0행 — 남의 lease를 지우지 않는다.
- TTL 기본 `BILLING_GENERATE_LEASE_TTL_MS = 120_000`(2분). HWPX 4종 zip은 보통 수초이나 안전마진. 만료 후 다음 generate가 steal 가능(crash 복구).

### SC-4. `GeneratorPort` 계약 변경 (task-06)

현행 `generate(task)` → **`generate(task, outDir)`**로 변경한다. `outDir`는 요청별 임시 절대경로(orchestrator가 만들어 전달). 생성기는 그 안에 파일을 쓰고 `GeneratorResult.files`의 `path`는 **최종 storage-relative 경로**(`out/workflows/<taskId>/…`)로 반환한다(승격 후 위치 기준).

```ts
// src/modules/workflows/types.ts (변경)
export interface GeneratorResult {
  files: Array<{ path: string; displayName: string; mimeType?: string; sizeBytes?: number }>;
}
export interface GeneratorPort {
  kind: WorkflowKind;
  generate(task: WorkflowTask, outDir: string): Promise<GeneratorResult>;
}
```

`recordGeneratedFiles`(services/generator.ts)·`createGeneratedFiles`(repositories)는 변경 없음 — `GeneratorResult.files`를 그대로 받는다.

### SC-5. billing 도메인 zod 스키마 (task-03)

```ts
// src/modules/workflows/validations/index.ts (추가)
import { z } from "zod";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_MONTHLY = MAX_SAFE / 12n; // J4: 12회차 누계 monthlyAmount*12도 안전정수 내

export const billingConfigSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  projectName: z.string().min(1),
  contractNumber: z.string().min(1),
  contractAmount: z.coerce.bigint().positive().refine((v) => v <= MAX_SAFE, "계약금액이 너무 큽니다."),       // F3
  monthlyAmount: z.coerce.bigint().positive().refine((v) => v <= MAX_MONTHLY, "월 청구금액이 너무 큽니다."),  // J4
  contractAmountKor: z.string().min(1),
  monthlyAmountKor: z.string().min(1),
});
export const billingConfigUpdateSchema = billingConfigSchema.partial().omit({ year: true });
export const billingRoundDateUpdateSchema = z.object({ submitDate: z.string().datetime() });

export type BillingConfigData = z.infer<typeof billingConfigSchema>;       // 금액은 bigint
export type BillingConfigUpdateData = z.infer<typeof billingConfigUpdateSchema>;
```

### SC-6. `repositories/billing.ts` 함수 시그니처 (task-03, 다른 task 소비)

```ts
export interface BillingConfigRow {
  id: string; year: number; projectName: string; contractNumber: string;
  contractAmount: bigint; monthlyAmount: bigint; contractAmountKor: string; monthlyAmountKor: string;
  createdAt: Date; updatedAt: Date;
}
export interface BillingRoundDateRow { id: string; year: number; round: number; submitDate: Date; }

export function findAllBillingConfig(): Promise<BillingConfigRow[]>;
export function findBillingConfigByYear(year: number): Promise<BillingConfigRow | null>;
export function createBillingConfig(data: BillingConfigData): Promise<BillingConfigRow>;
export function updateBillingConfigByYear(year: number, data: BillingConfigUpdateData): Promise<BillingConfigRow>;
export function deleteBillingConfigByYear(year: number): Promise<void>; // 회차 연쇄 삭제를 한 tx로
export function findRoundDatesByYear(year: number): Promise<BillingRoundDateRow[]>;
export function findRoundDate(year: number, round: number): Promise<BillingRoundDateRow | null>;
export function upsertRoundDate(year: number, round: number, submitDate: Date): Promise<BillingRoundDateRow>;
export function deleteRoundDate(year: number, round: number): Promise<void>;
```

### SC-7. `computeBillingPeriod` 순수함수 (task-05, task-06/08 소비) — KST 전월 기준(J2)

```ts
// src/modules/workflows/billing/period.ts
export function computeBillingPeriod(scheduledAt: Date): {
  projectYear: number;  // 전월이 속한 연도 (KST)
  round: number;        // 전월의 월 (1~12). 1월분 청구 = 1회차
  billingDate: Date;    // KST 기준 청구일 (scheduledAt와 같은 instant, KST 캘린더 필드 산정용)
};
```

전월 산정은 **반드시 Asia/Seoul 캘린더 기준**. JS `Date`의 로컬 메서드 금지(서버 TZ 비KST면 월 경계 오산 → 오청구). 기존 calendar 모듈의 KST 규약 재사용(task-05 Prep).

### SC-8. 단계별 첨부·전이 규칙 (task-10) — day-sync §4 정확 재현, 이 슬라이스는 1·2단계만

| step | 전이 | 첨부 | 이 슬라이스 |
| --- | --- | --- | --- |
| 1 (고객 승인요청) | GENERATED→SENT | `outputPath` 디렉터리 내 `.hwpx`(+`.xlsx`; 대금청구는 hwpx 4종) | 포함 |
| 2 (본사 서류요청) | SENT→HQ_REQUESTED | **첨부 없음** | 포함 |
| 3 (최종 발송) | HQ_REQUESTED→FINAL_SENT | 업로드 파일 | **이전(F2)** — 후속 UI spec |

`runSend`는 step ∈ {1,2}만 허용(3은 422/NotImplemented). 전이 정책 `HQ_REQUESTED→FINAL_SENT`는 `policy.ts`에 유지(이미 존재).

### SC-9. 공유 인프라 (기존 — 변경 없이 소비)

- `ConflictError`(`types.ts`) → API 409. `ForbiddenError`(`@/kernel/access`) → 403. `mapError`(`app/api/workflows/_shared.ts`)가 매핑, 그 외 rethrow(500).
- 라우트 표준: `auth()` → 401 가드 → `getPermissionSummary(userId)` → `buildTransitionCtx`/`buildMailCtx`(`_shared.ts`) → service → `NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })`. 봉투(`{success,…}`) 없음.
- 권한 게이트: `can(ctx, resource, action) = ctx.isOwner || ctx.permissionKeys.has(`${resource}:${action}`)`. `KIND_RESOURCE.BILLING = "workflows.billing"`, `ACTION_FOR_STATUS`(GENERATED→generate, SENT/HQ_REQUESTED→send)는 `policy.ts`에 존재.
- 메일: `sendMail(msg, config)`·`MailMessage{to,subject,html,attachments?:{filename,path}[]}`(`@/lib/integrations/mail`), `getSmtpConfig`(`@/kernel/settings/reader`). 경계 규칙: workflows 모듈은 `@/kernel/*`·`@/lib/*`·자기 모듈만 import.
- 전이 CAS: `applyTransitionAtomic({taskId,fromStatus,toStatus,actorId,note,stampField})`(repositories) — count===0이면 false → ConflictError.

### SC-10. 검증 게이트 (모든 task 공통 AC)

`npm run typecheck` / `npm run lint`(boundaries) / `npm test` / `npm run build` 통과. DB·SMTP·FS는 fake/tmp(node 환경). 스키마 변경은 task-07의 `GenerationLock` 1개뿐 → `npm run prisma:validate` + 마이그레이션.

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 파일 저장소 계층 + STORAGE_ROOT env | [ ] | [task-01](2026-06-29-workflows-billing-backend/task-01-storage-layer.md) | — | |
| 02 | WorkflowType(BILLING) 시드 + 권한/역할 grant | [ ] | [task-02](2026-06-29-workflows-billing-backend/task-02-seed-permissions.md) | — | |
| 03 | billing validations + repositories | [ ] | [task-03](2026-06-29-workflows-billing-backend/task-03-config-repository.md) | — | |
| 04 | 설정 CRUD service + API | [ ] | [task-04](2026-06-29-workflows-billing-backend/task-04-config-service-api.md) | 03 | |
| 05 | computeBillingPeriod 순수함수(KST) | [ ] | [task-05](2026-06-29-workflows-billing-backend/task-05-billing-period.md) | — | |
| 06 | GeneratorPort 계약 변경 + HWPX 4종 생성기 + 골든 | [ ] | [task-06](2026-06-29-workflows-billing-backend/task-06-hwpx-generator.md) | 01, 03, 05 | |
| 07 | GenerationLock lease(스키마+마이그레이션+repo CAS) | [ ] | [task-07](2026-06-29-workflows-billing-backend/task-07-generation-lease.md) | — | |
| 08 | runGenerate + registry + commit 전이 + generate route | [ ] | [task-08](2026-06-29-workflows-billing-backend/task-08-runGenerate.md) | 03, 05, 06, 07 | |
| 09 | mail/cancel 동시성 적응(가드·G2b·H1·D8·I4) | [ ] | [task-09](2026-06-29-workflows-billing-backend/task-09-mail-cancel-concurrency.md) | 01 | |
| 10 | runSend + send route(1·2단계) | [ ] | [task-10](2026-06-29-workflows-billing-backend/task-10-runSend.md) | 01, 08, 09 | |
| 11 | 다운로드 API(파일·ZIP) | [ ] | [task-11](2026-06-29-workflows-billing-backend/task-11-download-api.md) | 01 | |

권장 실행 순서: 01·02·03·05·07(상호 독립) → 04 → 06 → 08 → 09 → 10 → 11. 단계 완료 후 `dev-workflow:review-loop`로 impl 적대검증(spec §14 "impl 진입 전 연결" AC 검증).
