# Phase 5 — Leave 연차 도메인 포팅 (구현 계획)

- Spec: `docs/specs/2026-06-20-phase-5-leave-design.md`
- Discovery(규칙 SSOT): `docs/discovery/annual-leave-analysis.md`, POC: `D:/workspace/annual-leave/backend/src`
- Branch: `feat/phase-5-leave`

**Goal:** annual-leave POC의 연차 도메인(신청·승인·할당·이력)을 ops-hub 계층(Route Handler→Service→Repository→Prisma)·NextAuth·access-control로 충실 포팅하고, ANNUAL 일수에서 공휴일도 제외한다.

**Architecture:** `src/modules/leave`(rules·repositories·services·validations) + `src/kernel/holidays`(공유 공휴일 리더) + `/leave`·`/admin/leave` UI + `/api/leave`·`/api/admin/leave` 라우트. `usedDays`는 캐시 필드로 트랜잭션 atomic 증감 + recalculate 정합성.

**Tech Stack:** Next.js App Router, Prisma(PostgreSQL multiSchema), zod, @tanstack/react-query, vitest(node, in-memory prisma fake), date-fns.

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-20-phase-5-leave/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts

2개 이상 태스크가 참조하는 스키마·타입·시그니처·상수·관례. 태스크 파일은 이를 재인라인하지 않고 "entrypoint §Shared Contracts"로 참조한다.

### SC-1. 스키마 — `Holiday` 신설 (task 01)

`prisma/schema.prisma`에 추가. 기존 `LeaveRequest`/`LeaveAllocation`/`LeaveAllocationHistory`는 변경 없음.

```prisma
model Holiday {
  date      DateTime @id @db.Date   // 공휴일 1일 = 1행. 날짜가 PK
  name      String
  year      Int
  createdAt DateTime @default(now())

  @@index([year])
  @@schema("kernel")
}
```

기존 모델(참고, 변경 금지):
- `LeaveAllocation(@@unique([userId, year]))`: `allocatedDays`/`carriedOverDays`/`carriedOverExpiryDate`(`DateTime?`)/`usedDays` 전부 `Decimal @db.Decimal(6,2)`.
- `LeaveRequest`: `leaveType`(ANNUAL/HALF/QUARTER)·`leaveSubType`(MORNING/AFTERNOON)?·`quarterStartTime`?·`startDate`·`endDate`·`days`(Decimal)·`status`(PENDING/APPROVED/REJECTED/CANCELLED)·`reason`?·`reviewedById`?·`reviewedAt`?·`rejectionReason`?·`cancelledAt`?·`cancellationReason`?·`isCarriedOver`·`adminActionNote`?.
- `LeaveAllocationHistory`: `allocationId`·`userId`·`changeType`(INITIAL/ADD/DEDUCT/CARRYOVER/ADJUSTMENT)·`changeDays`(Decimal)·`reason`·`reasonDetail`?·`beforeDays`(Decimal)·`afterDays`(Decimal)·`createdById`?.

> **POC 적응 주의:** POC는 `reviewedBy`/`modifiedByAdminId`/`modifiedByAdminAt` 필드를 쓰지만 ops-hub 스키마엔 **없다**. 포팅 시 승인자=`reviewedById`, 관리자 수정 흔적=`adminActionNote`(+자동 `updatedAt`)로 매핑한다. `modifiedBy*`는 추가하지 않는다(YAGNI).

### SC-2. Decimal 취급

`usedDays`/`days` 등은 `Prisma.Decimal`이다. 산술은 **DB atomic `increment`/`decrement`** (`{ usedDays: { increment: days } }`)로 하고, 비교·합산이 필요한 순수 로직에서는 `Number(d)` 또는 `new Prisma.Decimal(...)`로 다룬다. 일수 계산 결과(0.5/0.25/정수)는 number로 계산해 Prisma가 Decimal로 저장한다. **read-then-write(`allocation.usedDays + days`)는 금지** — 동시성 경합(D2).

증감 대상 할당 행이 없으면 `updateMany().count===0`이다. 따라서 모든 전이·조정 tx(approve/createApproved/cancel/update/delete/recalculate)는 **할당 증감 결과 `count`를 검사해 0이면 `LeaveConflictError`로 throw·롤백**한다 — 특히 **교차연도 수정의 신규연도 할당 부재**(request는 갱신됐는데 새 연도 `usedDays`가 그대로 남아 캐시 불변식이 조용히 깨지는 경우)를 막는다. approveTx와 동일 가드를 update/cancel/delete/recalculate에 일관 적용.

### SC-3. 도메인 타입 (DTO)

`src/modules/leave/types.ts`에 정의(task 03에서 생성, 이후 태스크가 import):

```ts
import type { LeaveType, LeaveSubType, LeaveRequestStatus, AllocationChangeType } from "@prisma/client";

export interface CreateLeaveInput {
  leaveType: LeaveType;
  leaveSubType?: LeaveSubType | null;   // HALF일 때만
  quarterStartTime?: string | null;     // QUARTER일 때만 "HH:mm"
  startDate: string;                     // "YYYY-MM-DD"
  endDate: string;                       // "YYYY-MM-DD"
  reason?: string | null;
}

export interface AllocationSummary {
  year: number;
  allocatedDays: number;
  carriedOverDays: number;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
  carriedOverExpiryDate: Date | null;
}

export interface AdjustAllocationInput {
  userId: string;
  year: number;
  changeDays: number;          // 양수 크기(>0). 부호는 changeType이 결정(ADD=+, DEDUCT=-)
  changeType: "ADD" | "DEDUCT";
  reason: string;
  reasonDetail?: string | null;
}

// 권한·본인 판정 컨텍스트. 라우트가 세션+getPermissionSummary로 만든다.
export interface LeaveCtx {
  userId: string;
  isOwner: boolean;             // systemRole === "OWNER"
  permissionKeys: Set<string>;  // getPermissionSummary().keys
}
```

### SC-4. 도메인 에러 — `src/modules/leave/errors.ts` (task 03에서 생성)

```ts
// 입력·업무 규칙 위반 → 400. 상태 충돌(이미 처리됨 등) → 409. 권한은 kernel ForbiddenError(403) 재사용.
export class LeaveValidationError extends Error {
  constructor(message: string) { super(message); this.name = "LeaveValidationError"; }
}
export class LeaveConflictError extends Error {
  constructor(message: string) { super(message); this.name = "LeaveConflictError"; }
}
```

라우트 `mapError`(workflows `_shared.ts` 패턴): `ForbiddenError→403`, `LeaveConflictError→409`, `LeaveValidationError→400`, 그 외 rethrow(500).

### SC-5. rules.ts 시그니처 (task 03)

```ts
// 전부 순수. 현재시각·공휴일은 인자 주입(결정적 테스트).
export function calculateLeaveDays(leaveType: LeaveType, start: Date, end: Date, holidays: Set<string>): number;
export function validateDates(start: Date, end: Date, today: Date): void;          // 직원: 과거 거부 + start>end 거부 (위반 시 LeaveValidationError)
export function validateDatesForAdmin(start: Date, end: Date): void;               // start>end만 거부
export function validateLeaveTypeDates(leaveType: LeaveType, start: Date, end: Date): void; // HALF/QUARTER 단일일
export function calculateCarriedOverExpiry(year: number): Date;                    // 익년 6/30
export function toDateKey(d: Date): string;                                        // "YYYY-MM-DD" (KST 자정 기준)
```

규칙: ANNUAL=start~end 중 주말(토/일)·`holidays` 미포함 일수. HALF=0.5, QUARTER=0.25.

### SC-6. 공휴일 리더 + 공공데이터 sync (task 02)

`Holiday` 테이블이 day-calc 출처(결정적). 채움은 공공데이터포털 특일정보 API에서 동기화.

```ts
// src/lib/integrations/holidays/index.ts — 공공데이터 특일정보 클라이언트
export interface RawHoliday { date: string; name: string; }            // date = "YYYY-MM-DD"
export function fetchHolidays(year: number): Promise<RawHoliday[]>;     // getRestDeInfo 12개월 호출·파싱. env DATA_GO_KR_SERVICE_KEY

// src/kernel/holidays/index.ts
export function getHolidaysInRange(start: Date, end: Date): Promise<Set<string>>;  // "YYYY-MM-DD"(UTC) Set
export function syncHolidaysForYear(year: number): Promise<number>;     // fetch(트랜잭션 밖)→연도 전량을 단일 $transaction으로 upsert(부분 적재 방지), 반환=건수
export function ensureYearsSynced(years: number[]): Promise<void>;      // 미적재(count===0) 연도만 sync 시도, 실패는 로그 후 진행(부팅 안 막음)
export function getUnsyncedYears(years: number[]): Promise<number[]>;   // 여전히 미적재(count===0)인 연도 반환 — 직원 fail-closed 게이트·admin 미적재 알림
```

- 환경변수: `DATA_GO_KR_SERVICE_KEY`(공공데이터포털 인증키). `.env.example`에 추가.
- 자동 트리거: `src/instrumentation.ts`의 `register()`가 부팅 시 `ensureYearsSynced([currentYear, currentYear+1])`. 시드(task 01)·요청 backstop(task 06)도 호출. (별도 백그라운드 타이머는 두지 않음 — 미적재 보강은 admin 알림+수동 sync로.)
- **fail-closed(D8)**: 직원 `createLeaveRequest`는 `ensureYearsSynced` 후 `getUnsyncedYears(spannedYears)`로 미적재면 `LeaveValidationError`로 차단한다. 관리자 경로(`createLeaveRequestByAdmin`/`updateByAdmin`)는 차단하지 않고 `console.warn`만 하고 통과(#1).
- **admin 알림**: 관리자 화면(task 11)이 `GET /api/admin/leave/holidays/sync`로 현재+익년 미적재를 조회해 배너로 알리고, `POST .../holidays/sync?year`로 수동 동기화한다(성공할 때까지 접속 시 알림).
- `getHolidaysInRange`는 테이블만 읽는다(sync 안 함). day-calc는 항상 테이블 기준 → 결정적.
- `syncHolidaysForYear`는 fetch(네트워크) 후 연도 전체를 **단일 트랜잭션**으로 write → 부분 적재 시 롤백되어 `count===0` 유지. 일부만 적재된 채 실패해 `count>0`로 `ensureYearsSynced`가 영구 skip(누락 공휴일이 평일 처리돼 연차 과다 차감)하는 일을 차단한다.

### SC-7. 권한 키 (task 07이 보강·부여)

리소스: `leave.request`/`leave.approval`/`leave.allocation`. 액션 catalog에 **`cancel` 신설**.
- 직원(작업자 role 전원 + pm): `leave.request:view`/`create`(기존), `leave.request:cancel`(신규 부여).
- 관리자(pm=`["*"]`/OWNER): `leave.approval:view`/`approve`, `leave.allocation:view`/`configure`, `leave.request:update`/`delete`.
- 서버 `requirePermission(userId, resource, action)` ↔ UI `useCan` 동일 키. fail-closed, OWNER 우회.

### SC-8. 관례 (기존 코드 패턴 준수)

- **라우트**: `const session = await auth(); if (!session?.user) 401`. zod `safeParse`(실패 400). `getPermissionSummary(session.user.id)`로 `LeaveCtx` 구성. `try { … } catch (e) { return mapError(e); }`. 응답 `NextResponse.json(..., { headers: { "Cache-Control": "no-store" } })`.
- **권한 게이트**: 라우트에서 `await requirePermission(userId, resource, action)` 호출 후 서비스 진입(서비스는 본인/대상 게이트만 추가 검사 — `LeaveCtx`로 판정).
- **UI**: `"use client"` + `useQuery`/`useMutation`(@tanstack/react-query). ui 프리미티브는 `@/components/ui/{badge,button,card,input,label,separator,textarea}`만 존재 — **Dialog/Select/Table 없음**, 네이티브 `<select>`/`<table>`+Tailwind로 조합(calendar-view 패턴). 권한 게이트는 `useCan`(`@/lib/auth/permissions-client`).
- **테스트**: vitest node. Prisma는 `vi.mock("@/lib/prisma")` in-memory fake(calendar/workflows 테스트 패턴 따름). 서비스/규칙은 DB·외부 없이.
- **Prisma 접근**: `leave/repositories`와 `kernel/holidays`에서만. 서비스는 repository 경유.
- 커밋: AI 서명 금지(글로벌 규칙).

### SC-9. 게이트 (모든 태스크 공통 AC)

`npm run typecheck` · `npm run lint` · `npm test` 그린. 스키마 변경 태스크는 `npm run prisma:validate` + `npm run prisma:generate`. 최종 `npm run build`.

---

## Tasks

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | Holiday 스키마·마이그레이션 | [ ] | [task-01](2026-06-20-phase-5-leave/task-01-holiday-schema.md) | — | |
| 02 | kernel/holidays 리더 + 공공데이터 sync | [ ] | [task-02](2026-06-20-phase-5-leave/task-02-holidays-reader.md) | 01 | |
| 03 | leave rules·types·errors (순수 도메인) | [ ] | [task-03](2026-06-20-phase-5-leave/task-03-leave-rules.md) | — | |
| 04 | leave repository·validations | [ ] | [task-04](2026-06-20-phase-5-leave/task-04-leave-repository.md) | 01 | |
| 05 | allocations 서비스 (요약·조정·recalc) | [ ] | [task-05](2026-06-20-phase-5-leave/task-05-allocations-service.md) | 03,04 | |
| 06 | requests 서비스 (신청·승인·취소·관리자) | [ ] | [task-06](2026-06-20-phase-5-leave/task-06-requests-service.md) | 02,03,04,05 | |
| 07 | 권한 catalog·seed 보강 | [ ] | [task-07](2026-06-20-phase-5-leave/task-07-permissions.md) | — | |
| 08 | API 라우트 — 직원 | [ ] | [task-08](2026-06-20-phase-5-leave/task-08-api-employee.md) | 05,06,07 | |
| 09 | API 라우트 — 관리자 | [ ] | [task-09](2026-06-20-phase-5-leave/task-09-api-admin.md) | 05,06,07 | |
| 10 | UI — 직원 /leave | [ ] | [task-10](2026-06-20-phase-5-leave/task-10-ui-employee.md) | 08 | |
| 11 | UI — 관리자 /admin/leave + 데모 시드 | [ ] | [task-11](2026-06-20-phase-5-leave/task-11-ui-admin.md) | 09 | |

실행: `superpowers:subagent-driven-development`. 의존 순서 준수(01→02, 01→04, 03·04→05, …). 03·07은 선행 의존 없음(병렬 가능).
