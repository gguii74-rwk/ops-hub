# Phase 1 — 확장·분리 골격 위의 공통 기반

- **Goal:** 모듈형 모놀리스의 **공통 기반(인증·RBAC·감사·내비게이션)** 과 **확장·분리 골격(3계층 경계·이벤트/outbox·신원 연동 seam)** 을 첫 마이그레이션과 함께 세운다. 도메인 비즈니스 로직·calendar 투영·실제 KGS forward-auth 프록시는 **이 플랜에 없다**(별도 플랜).
- **Architecture:** Next.js 16 App Router 모듈형 모놀리스. 3계층 `kernel`(모두가 의존) ← `module`(도메인, 서로 직접 참조 금지) ← `app`/`lib`. 계층 경계는 `eslint-plugin-boundaries`로 CI에서 강제. 모듈 간 협업은 `kernel`의 outbox 이벤트로만. 인증은 NextAuth v5 Credentials(JWT 세션), 외부 연동은 `lib/auth/federation` 한 곳에 격리.
- **Tech Stack:** Next 16.1.x, React 19, TypeScript 5.9, Prisma 6.19(PostgreSQL, `multiSchema` preview), NextAuth `5.0.0-beta`, bcryptjs 3, zod 4, vitest(신규), eslint 9 flat + eslint-plugin-boundaries(신규).
- **관련 문서:** [spec](../specs/2026-06-17-modular-extensibility-design.md), [access-control](../architecture/access-control.md), [calendar-design](../architecture/calendar-design.md), [roadmap](../product/modernization-roadmap.md).

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-17-phase-1-foundation/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## 범위 — spec §11 AC 매핑

확정 범위(공통 기반 + 경계 골격) 기준, spec §11 Acceptance Criteria의 Phase 1 소유 여부:

| spec §11 AC | Phase 1 | 비고 |
| --- | --- | --- |
| 3계층 디렉터리·의존 규칙 | ✅ task-01 | |
| eslint-boundaries가 모듈간·kernel→module 차단 | ✅ task-01 | `no-unknown` 포함, 위반 심기로 증명 |
| 모듈 간 통신 outbox만 | ◑ task-05 | 버스 seam만(발행자·핸들러는 도메인 플랜) |
| 원본 CRUD가 투영 반영 + reconciler 검증 | ⛔ deferred | calendar 투영 플랜 소유. Phase 1은 outbox 테이블·발행 헬퍼만 |
| CalendarEvent 소프트참조 + calendar 독립 | ✅ task-02 | 스키마 한정(모듈 코드는 도메인 플랜) |
| 외부 SSO + 프록시 X-Auth-* strip | ◑ task-07 | ops-hub측 `/api/auth/verify`만. 프록시 설정·strip 검증은 연동 플랜 |
| federation 격리, A→B 시 모듈/커널 불변 | ✅ task-07 | |

⛔/◑ 는 누락이 아니라 **확정된 deferred** — seam은 Phase 1에 깔고, 소비자 결합 작업만 후속 플랜으로 분리한다.

## Shared Contracts

모든 task가 이 절을 함께 읽는다. 공유 타입·상수·시그니처는 여기 **한 번만** 둔다. task 파일은 재인라인하지 말고 "entrypoint §Shared Contracts"를 가리킨다.

### SC-1. 디렉터리·경계 요소(element) 분류

```text
src/
  kernel/        ← 공유 커널: identity·user·access(RBAC)·audit·events(outbox)·navigation. 모듈을 모른다.
  modules/<m>/   ← 도메인 모듈(Phase 1엔 비어 있음). index.ts만 공개. 서로 직접 import 금지.
  lib/           ← 공용 유틸·인프라: prisma, auth, auth/federation, api, validation.
  app/           ← Next App Router(route handler·page·layout). 위 모두 사용 가능.
```

- 경로 alias: `@/*` → `src/*` (tsconfig `paths`).
- boundaries 요소 타입과 **허용 의존**(이 외 전부 금지, fail-closed):

  | from \ to | kernel | lib | module(같은 이름) | module(다른 이름) | app |
  | --- | --- | --- | --- | --- | --- |
  | `lib` | ❌ | ✅ | ❌ | ❌ | ❌ |
  | `kernel` | ✅ | ✅ | ❌ | ❌ | ❌ |
  | `module` | ✅ | ✅ | ✅(자기 자신) | ❌ | ❌ |
  | `app` | ✅ | ✅ | ✅ | ✅ | ✅ |

  핵심 규칙 두 개(spec §5): **module → 다른 module 금지**, **kernel → module 금지**.

### SC-2. Prisma 스키마 규약 (multiSchema)

- datasource `schemas = ["kernel", "workflows", "leave", "calendar"]`, generator `previewFeatures = ["multiSchema"]`.
- 스키마 소유: `kernel` = User·AccessRole·Permission·RolePermission·UserAccessRole·UserPermissionOverride·NavigationItem·SystemSetting·AuditLog·**OutboxEvent**. `workflows` = WorkflowType·WorkflowTask·GeneratedFile·MailDelivery·BillingConfig·BillingRoundDate·Deliverable. `leave` = LeaveAllocation·LeaveAllocationHistory·LeaveRequest. `calendar` = CalendarSource·CalendarEvent·CalendarCacheEntry.
- **모든 모델과 모든 enum**에 `@@schema("...")`를 단다(multiSchema는 enum에도 필수). enum은 1차 소유 모듈 스키마에 둔다.
- **커널→모듈 역참조 금지**: `User`는 모듈 모델로의 관계 컬렉션을 갖지 않는다. 모듈 모델은 `userId String`(plain, FK·relation 없음)으로만 커널을 가리킨다. 커널 내부 관계(AuditLog.actor, UserAccessRole, UserPermissionOverride 등 kernel↔kernel)는 유지.
- **CalendarEvent는 소프트 참조**: `workflowTaskId/leaveRequestId` 하드 FK 제거 → `originModule String?` + `originId String?` + `@@index([originModule, originId])`. (기존 `sourceId`/`source`는 이미 CalendarSource feed FK라 충돌 회피 위해 origin* 사용 — spec의 `sourceModule/sourceId`를 이 스키마 맥락에 맞게 명명.) 정합성은 이벤트(SC-4)+reconciler(별도 플랜)가 책임.

### SC-3. OutboxEvent 모델 (kernel)

```prisma
enum OutboxStatus {
  PENDING
  DONE
  FAILED

  @@schema("kernel")
}

model OutboxEvent {
  id          String       @id @default(cuid())
  type        String       // "<module>.<entity>.<action>" 예: "leave.request.approved"
  payload     Json
  status      OutboxStatus @default(PENDING)
  attempts    Int          @default(0)
  lastError   String?
  createdAt   DateTime     @default(now())
  processedAt DateTime?

  @@index([status, createdAt])
  @@schema("kernel")
}
```

### SC-4. 이벤트 버스 시그니처 (`src/kernel/events`)

```ts
// outbox payload는 Json 컬럼 → JSON 직렬화 가능한 값만(클래스·undefined·함수 차단).
export type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[];
// 이벤트 타입명 규약: `${module}.${entity}.${action}`, action ∈ created|updated|deleted (+도메인 동사)
export interface DomainEvent<P extends JsonValue = JsonValue> {
  type: string;
  payload: P;
}
// 원본 변경과 "같은 트랜잭션"으로 outbox에 기록한다(놓침 불가).
export function publishEvent(tx: PrismaTx, event: DomainEvent): Promise<void>;
// 핸들러 레지스트리. 핸들러는 멱등(idempotent)이어야 한다.
export type EventHandler = (event: DomainEvent) => Promise<void>;
export function registerHandler(type: string, handler: EventHandler): void;
// PENDING을 읽어 dispatch 후 DONE/FAILED 표시(단일 러너 골격, 동시 실행 금지). 프로덕션 상태머신은 디스패처 플랜.
export function processOutbox(limit?: number): Promise<{ processed: number; failed: number }>;
```

`PrismaTx`는 `Prisma.TransactionClient`(아래 SC-8).

### SC-5. 접근 제어 시그니처 (`src/kernel/access`)

```ts
export type Action = "view" | "create" | "update" | "delete" | "approve"
  | "generate" | "review" | "send" | "configure" | "export" | "impersonate";
export type Scope = "own" | "team" | "assigned" | "all";

export interface PermissionRule { effect: "ALLOW" | "DENY"; scope: Scope; }
export interface DecisionInput {
  isOwner: boolean;                  // systemRole === OWNER
  overrides: PermissionRule[];       // 유효기간 내 UserPermissionOverride
  roleRules: PermissionRule[];       // 부여된 role의 RolePermission
}
// 순수 함수. 우선순위(spec/ADR-0002): OWNER → override DENY → override ALLOW → role DENY → role ALLOW → 기본 거부.
export function computeDecision(input: DecisionInput): boolean;

export interface PermissionSummary { keys: string[]; } // "resource:action" 허용 목록(메뉴/UI용)
export async function getPermissionSummary(userId: string): Promise<PermissionSummary>;
export async function hasPermission(userId: string, resource: string, action: Action): Promise<boolean>;
export class ForbiddenError extends Error {}
export async function requirePermission(userId: string, resource: string, action: Action): Promise<void>; // 거부 시 ForbiddenError
```

- 권한 키 문자열 표기 = `` `${resource}:${action}` ``.
- 세션엔 권한 목록을 넣지 않는다(SC-6). summary는 `/api/auth/permissions`로 별도 조회.
- **scope 처리(중요·fail-closed):** 컨텍스트 없는 검사(`hasPermission`/`requirePermission`/`getPermissionSummary`)는 ALLOW를 `scope:"all"`만 허가로 인정한다. `own/team/assigned`는 target 컨텍스트가 있어야 평가 가능하므로 전역 검사에선 허가로 치지 않는다(스코프 ALLOW를 전역 허가로 오인 → 권한 누수 방지). DENY는 스코프 무관하게 거부(보수적). 스코프 인지 평가(target 전달 API)는 해당 리소스가 생기는 도메인 플랜으로 위임.

### SC-6. 세션/사용자 형태 (NextAuth v5)

```ts
// next-auth 모듈 보강(src/lib/auth/types.ts에서 declare)
declare module "next-auth" {
  interface Session { user: SessionUser; }
}
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  systemRole: "OWNER" | "ADMIN" | "MANAGER" | "MEMBER";
  employmentType: "REGULAR" | "CONTRACTOR";
  jobFunction: "PM" | "DEVELOPER" | "CONTENT_MANAGER" | "CIVIL_RESPONSE";
}
```

세션엔 위 coarse 정보만. JWT 콜백에서 토큰에 싣고 session 콜백에서 `session.user`로 복사.

### SC-7. 신원 연동 seam (`src/lib/auth/federation`)

```ts
export interface Identity { sub: string; email: string; groups: string[]; } // 외부에 넘기는 "최소 신원"
export async function verifySession(): Promise<Identity | null>;             // ops-hub 세션이 유효한가
export function issueClaims(user: SessionUser): Identity;                     // 외부용 claims 생성
// coarse groups 매핑(코드 상수, spec §8). 모든 인증 사용자: "kgs-user". OWNER/ADMIN: +"ops-admin". MANAGER: +"ops-manager".
export function toGroups(user: SessionUser): string[];
```

A안(forward-auth)→B안(OIDC) 전환 시 이 디렉터리 **한 곳만** 바뀐다. 외부 노출 헤더: `X-Auth-Sub` / `X-Auth-Email` / `X-Auth-Groups`(콤마 구분).

### SC-8. Prisma 클라이언트·트랜잭션 타입 (`src/lib/prisma`)

```ts
import { PrismaClient, Prisma } from "@prisma/client";
export const prisma: PrismaClient;            // 전역 싱글톤(dev HMR 가드)
export type PrismaTx = Prisma.TransactionClient;
```

### SC-9. 권한 카탈로그·역할·내비게이션 키 (seed·engine·nav 공유)

`src/kernel/access/catalog.ts`에 단일 정의(seed/nav가 import). 표기 `resource:action`.

```ts
export const RESOURCES = [
  "dashboard", "calendar.work", "calendar.leave", "calendar.personal", "calendar.team", "calendar.admin",
  "workflows.weekly", "workflows.billing", "workflows.notification",
  "leave.request", "leave.approval", "leave.allocation",
  "admin.users", "admin.settings", "admin.audit",
  "integrations.google", "integrations.smtp", "integrations.templates",
] as const;

export const ACCESS_ROLE_KEYS = [
  "pm", "regular-developer", "contractor-developer", "contractor-content", "contractor-civil-response",
] as const;

// 상단 내비게이션 키 = 보호 라우트 5종. requiredPermission으로 메뉴/라우트 동시 제어.
export const NAV = [
  { key: "dashboard", label: "대시보드", href: "/dashboard", permission: "dashboard:view" },
  { key: "calendar",  label: "캘린더",   href: "/calendar",  permission: "calendar.work:view" },
  { key: "workflows", label: "업무",     href: "/workflows", permission: "workflows.weekly:view" },
  { key: "leave",     label: "연차",     href: "/leave",     permission: "leave.request:view" },
  { key: "admin",     label: "관리",     href: "/admin",     permission: "admin.users:view" },
] as const;
```

초기 권한 매트릭스(누가 무엇을)는 access-control.md "초기 권한 매트릭스 초안"을 단일 출처로 삼아 task-09(seed)에서 `RolePermission`으로 인코딩한다.

### SC-10. 검증 명령(실행 환경 전제)

- `npm run prisma:validate` — DB 없이 동작(스키마 검증).
- `npm run prisma:migrate` / seed / `auth()` 동작 검증 — 로컬 PostgreSQL 필요(`.env`의 `DATABASE_URL`). 환경·접속 정보는 `workspace-env/INVENTORY.md` 참조.
- `npm run lint` / `npm run typecheck` / `npm test`(vitest) — task-01 완료 후 동작.

---

## Tasks

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 툴링·앱 스캐폴드·3계층 경계(eslint-boundaries·vitest) | [x] | [task-01](2026-06-17-phase-1-foundation/task-01-tooling-and-scaffold.md) | — | Next 16 앱 스캐폴드, eslint-boundaries 3계층 경계 강제, vitest 설정 완료 |
| 02 | schema.prisma 재구성(multiSchema·소프트참조·커널정리·outbox) | [x] | [task-02](2026-06-17-phase-1-foundation/task-02-schema-multischema.md) | — | 4 schema multiSchema, CalendarEvent 소프트참조(originModule/Id), OutboxEvent 추가 |
| 03 | Prisma 클라이언트 싱글톤 + 첫 마이그레이션 | [x] | [task-03](2026-06-17-phase-1-foundation/task-03-prisma-client-and-migration.md) | 01, 02 | PostgreSQL opshub DB, migration 20260617225534_init, prisma singleton |
| 04 | 권한 엔진(deny 우선·fail-closed) + requirePermission | [x] | [task-04](2026-06-17-phase-1-foundation/task-04-permission-engine.md) | 03 | computeDecision deny-first TDD 9/9, hasPermission/requirePermission/getPermissionSummary |
| 05 | 감사 로그 + outbox 발행/디스패처(이벤트 버스 골격) | [x] | [task-05](2026-06-17-phase-1-foundation/task-05-audit-and-outbox.md) | 03 | logAuditEvent, publishEvent, processOutbox 골격, 12 TDD 테스트 |
| 06 | NextAuth v5 Credentials + 세션 + 로그인 | [x] | [task-06](2026-06-17-phase-1-foundation/task-06-auth-credentials.md) | 03 | NextAuth v5 Credentials, JWT 세션, /login 페이지, typecheck/lint/build 0 |
| 07 | 라우트 보호 미들웨어 + federation seam + /api/auth/verify | [x] | [task-07](2026-06-17-phase-1-foundation/task-07-route-protection-and-federation.md) | 06 | middleware matcher 16 TDD, federation seam, /api/auth/verify 307→/login smoke OK |
| 08 | 권한 summary API + useCan 훅 + requirePermission 배선 | [x] | [task-08](2026-06-17-phase-1-foundation/task-08-permission-summary-and-usecan.md) | 04, 06 | /api/auth/permissions, useCan 훅, /api/admin/audit requirePermission 배선 |
| 09 | seed(admin·roles·permission matrix·nav) | [x] | [task-09](2026-06-17-phase-1-foundation/task-09-seed.md) | 03 | 33 권한, 5 역할, 71 RolePermission, 5 nav, admin@uracle.co.kr OWNER 생성 |
| 10 | 내비게이션 셸 + 보호 placeholder 페이지 | [x] | [task-10](2026-06-17-phase-1-foundation/task-10-navigation-and-pages.md) | 08, 09 | 앱 셸 layout, 권한 필터 nav 5개, 5개 보호 라우트, useCan /admin 데모, typecheck/lint/build 0 |

실행 순서 권장: 01 → 02 → 03 → (04·05·06 병렬 가능) → 07 → 08 → 09 → 10.
