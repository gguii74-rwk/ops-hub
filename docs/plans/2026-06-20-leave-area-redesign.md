# 연차 영역 재구성 + 원본 기능 완전 포팅 — 구현 계획 (엔트리포인트)

- 날짜: 2026-06-20
- spec: `docs/specs/2026-06-20-leave-area-redesign-design.md` (이 계획의 SSOT)
- 원본 SSOT: `C:\workspace\annual-leave` (GitHub `gguii74-rwk/annual-leave`, `master`)
- 브랜치: `feat/leave-area-redesign`

## Goal

원본 `annual-leave`의 사용자/관리자 화면과 기능(대시보드·현황·전체내역·연차 전용 캘린더·관리자 직접입력/수정/삭제 모달·알림 메일)을 ops-hub 구조(권한 모델·가로 탭·기존 leave 리포지토리)에 **그대로 포팅**하되, 삭제 감사·권한 경계·캘린더 프라이버시·메일 전달보장은 ops-hub 원칙으로 강화한다.

## Architecture

Next.js App Router 모듈형 모놀리스. `/leave`를 **상단 가로 탭**(App Router 세그먼트)으로 재구성하고, 각 탭은 서버 `requirePermission` + UI `useCan`로 이중 가드한다. 메일은 기존 `MailDelivery`(workflows 스키마)를 **outbox 패턴**으로 확장해 연차 트랜잭션 내부에서 `PENDING` 행을 적재하고, **하이브리드 worker**(요청 직후 fire-and-forget drain + 시스템 cron이 호출하는 `POST /api/leave/mail/drain`)가 lease 기반으로 발송한다.

## Tech Stack

Next.js(App Router) · TypeScript · Prisma(PostgreSQL, multiSchema) · zod · @tanstack/react-query · nodemailer · exceljs · vitest. UI 프리미티브: `src/components/ui/*`(Tabs 컴포넌트는 **없음** → 신규 구현).

---

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-20-leave-area-redesign/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts

이 절은 2개 이상 태스크가 공유하는 계약이다. 태스크 파일은 이 절을 재인용하지 않고 "엔트리포인트 §Shared Contracts"로 참조한다.

### SC-1. 기존 코드 자산 (변경 없이 재사용 — import 그대로)

| 심볼 | 경로 | 시그니처/용도 |
|---|---|---|
| `prisma`, `PrismaTx` | `@/lib/prisma` | Prisma client / 트랜잭션 클라이언트 타입 |
| `requirePermission(userId, resource, action)` | `@/kernel/access` | 실패 시 `throw ForbiddenError`. void 반환 |
| `hasPermission(userId, resource, action)` | `@/kernel/access` | boolean |
| `getPermissionSummary(userId)` | `@/kernel/access` | `{ keys: string[] }` |
| `ForbiddenError` | `@/kernel/access` | 403 매핑 대상 |
| `useCan(resource, action)` | `@/lib/auth/permissions-client` | 클라이언트 boolean 훅 |
| `auth()` | `@/lib/auth` | 세션. `session.user`: `{ id, email, name, systemRole, employmentType, jobFunction }` |
| `writeAudit(client, { actorId, entityType, entityId, action, metadata })` | `@/kernel/audit` | tx 또는 prisma로 감사 1건 |
| `sendMail(msg)` → `{ providerMessageId }` | `@/lib/integrations/mail` | `MailMessage { to: string[]; subject; html; attachments? }` |
| `mapError`, `buildLeaveCtx`, `parseYear`, `parseStatusList` | `@/app/api/leave/_shared` | 라우트 공통. `mapError`는 Forbidden→403/Conflict→409/Validation→400, 그 외 rethrow |
| `LeaveConflictError`, `LeaveValidationError` | `@/modules/leave/errors` | mapError 대상 |
| `LeaveCtx { userId; isOwner; permissionKeys: Set<string> }` | `@/modules/leave/types` | 권한 컨텍스트 |
| rules: `parseLeaveDate`, `toDateKey`, `kstToday`, `calculateLeaveDays`, `validateDates(ForAdmin)`, `validateLeaveTypeDates` | `@/modules/leave/rules` | 날짜·일수 규칙(UTC 자정 기준) |
| 공휴일: `ensureYearsSynced`, `getUnsyncedYears`, `getHolidaysInRange` | `@/kernel/holidays` | 신청 시 영업일 계산 선행 |

라우트 표준 패턴(모든 신규 라우트가 따른다):
```ts
const session = await auth();
if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
// (필요 시) body/query 파싱 → 400
try {
  await requirePermission(session.user.id, "<resource>", "<action>");
  /* service 호출 */
  return NextResponse.json({ /* ... */ }, { headers: { "Cache-Control": "no-store" } });
} catch (error) { return mapError(error); }
```

### SC-2. 권한 키 (canonical — page·route·service·test에 동일 적용)

| 키 | 용도 | 신규? |
|---|---|---|
| `leave.request:view` | 본인 요약·내역·캘린더·대시보드 진입 | 기존(catalog `leave.request` + ROLE_ALLOW 전 역할) |
| `leave.request:create` | 신청 | 기존 |
| `leave.request:cancel` | 취소 | 기존 |
| `leave.request:update` | **관리자 수정**(전체내역 수정 컨트롤·PATCH) | 기존 |
| `leave.request:delete` | **관리자 삭제**(soft-delete 컨트롤·DELETE) | 기존 |
| `leave.approval:view` | **승인 대기 큐 전용**(`/leave/approvals`, drain 아님) | 기존 |
| `leave.approval:approve` | 승인/반려/직접입력/사용자목록 | 기존 |
| `leave.allocation:view` / `:configure` | 할당 조회 / 설정·조정·공휴일 | 기존 |
| `leave.status:view` | 전체 현황·엑셀, **대시보드 cross-user 통계 게이트** | **신규** |
| `leave.admin:view` | 전체(타인 포함) 신청 내역 조회, **대시보드 cross-user 통계 게이트** | **신규** |

신규 2종 seed 방법(Task 01): `src/kernel/access/catalog.ts`의 `RESOURCES`에 `"leave.status"`, `"leave.admin"` 추가 → `prisma/seed.ts`의 `VIEW_RESOURCES = [...RESOURCES]`가 `:view`를 자동 생성. **EXTRA_PERMISSIONS·ROLE_ALLOW 수정 불필요**(view만 필요; pm은 `"*"`, OWNER는 systemRole bypass로 자동 보유). NAV 카탈로그에는 **추가하지 않는다**(가로 탭은 NavigationItem이 아니라 별도 컴포넌트).

경계 규칙(spec §4, fail-closed, deny 우선):
- 전체 이력 조회 = `leave.admin:view` 단일 canonical. `GET /api/admin/leave/requests` GET 가드를 `leave.approval:view` → `leave.admin:view`로 변경(POST 직접입력은 `leave.approval:approve` 유지).
- 승인 큐는 전용 `GET /api/admin/leave/approvals`(`leave.approval:view`)만 사용 — 전체이력 권한 불요.
- 대시보드 cross-user 통계 블록은 `leave.status:view` 또는 `leave.admin:view` 보유 시에만 렌더(`leave.approval:view`만으론 비노출).

### SC-3. Schema 변경 (Task 01에서 적용; 전 태스크가 참조)

`prisma/schema.prisma` 변경분(정확한 필드명·타입):

`LeaveRequest`(@@schema "leave")에 추가:
```prisma
  createdByAdminId   String?
  createdByAdminAt   DateTime?
  modifiedByAdminId  String?
  modifiedByAdminAt  DateTime?
  deletedByAdminId   String?
  deletedAt          DateTime?
  deleteReason       String?
```
+ 인덱스 `@@index([deletedAt])`. (relation 없이 admin id 문자열만 — 감사·뱃지용.)

`MailDelivery`(@@schema "workflows")에 추가:
```prisma
  leaveRequestId String?
  eventType      String?   // REQUESTED | APPROVED | REJECTED | ADMIN_CREATED
  attempts       Int       @default(0)
  lockedUntil    DateTime?
  workerId       String?

  @@unique([leaveRequestId, eventType])
  @@index([leaveRequestId])
  @@index([status, lockedUntil])
```
(`leaveRequestId`는 cross-schema relation 회피 위해 **id 문자열만** 저장 — leave 스키마 `LeaveRequest`와 FK 없음.)

`MailDeliveryStatus` enum에 추가: `PENDING`, `CANCELLED` (기존 `SENDING/SENT/FAILED` 유지).

migration: `prisma/migrations/<ts>_leave_area_redesign/migration.sql` 신규(기존 3개 migration과 동일 형식). DB 없는 CI 검증은 `npm run prisma:validate`.

### SC-4. 메일 outbox 계약 (Task 03 구현, Task 06이 트리거)

상수: `MAIL_MAX_ATTEMPTS = 3`, `MAIL_LEASE_MS = 60_000`. 이벤트: `REQUESTED`(신청→관리자 통지) / `APPROVED` / `REJECTED` / `ADMIN_CREATED`(직접입력 sendNotification 시 신청자 통지).

- **insert(트랜잭션 내부, idempotent):** 연차 작업 tx 안에서 `tx.mailDelivery.create({ leaveRequestId, eventType, status: "PENDING", recipients(JSON string[]), subject, bodyHtml, attempts: 0 })`. `@@unique([leaveRequestId,eventType])` P2002는 **조용히 무시**(이벤트당 행 1개).
- **수신자(systemRole 기반):** `getLeaveAdminRecipients()` = `systemRole IN (OWNER, ADMIN, MANAGER) AND status = ACTIVE` 사용자 email 배열(REQUESTED용). 신청자 통지(APPROVED/REJECTED/ADMIN_CREATED)는 해당 `LeaveRequest.user.email`.
- **drain 후보(leave 스코프):** `leaveRequestId IS NOT NULL AND eventType IS NOT NULL AND ( status=PENDING OR (status=FAILED AND attempts < N) OR (status=SENDING AND lockedUntil < now AND attempts < N) )`. workflow 행(`leaveRequestId IS NULL`)은 **절대 집지 않음**.
- **claim(atomic 조건부 update):** 위 조건에 맞을 때만 `status=SENDING, lockedUntil=now+lease, workerId=self, attempts: { increment: 1 }`. 영향 0행이면 선점됨 → skip.
- **finalize(조건부 — `WHERE id AND status=SENDING AND workerId=self`):** 성공 → `SENT`(+providerMessageId·sentAt·lockedUntil=null), SMTP 실패 → `FAILED`(+errorMessage·lockedUntil=null). **영향 0행이면**(그 사이 `CANCELLED` 또는 타 worker) 결과 폐기, terminal 상태를 덮어쓰지 않음(삭제-발송 race 안전).
- **cancel(soft-delete tx 내부):** 해당 `leaveRequestId`의 `PENDING/FAILED/(stale)SENDING` 행을 `CANCELLED`로(`SENT/CANCELLED`은 제외). worker는 `CANCELLED`를 후보로 보지 않음.
- **전달 보장:** at-least-once(누락 방지). `SENDING` reclaim도 `attempts++` + `attempts < N` 게이트(무한 재발송 방지). provider idempotency는 `providerMessageId`로 기록(드문 중복 허용, exactly-once 비목표).
- **구동(하이브리드):** 연차 작업 라우트가 커밋 성공 후 `void drainLeaveMailOutbox(workerId)`(await 안 함, 실패가 응답을 막지 않음) + `POST /api/leave/mail/drain`(시스템 cron이 주기 호출, 누락 보충).

### SC-5. 표시 헬퍼·상수 (Task 02; UI 태스크가 import)

`src/modules/leave/labels.ts`(신규 — 기존 `src/app/(app)/leave/labels.ts`의 TYPE/SUBTYPE/STATUS 상수도 여기로 통합):
```ts
export const QUARTER_TIME_SLOTS = [
  { start: "09:00", end: "11:00", label: "09:00 ~ 11:00" },
  { start: "10:00", end: "12:00", label: "10:00 ~ 12:00" },
  { start: "11:00", end: "14:00", label: "11:00 ~ 14:00 (점심 포함)" },
  { start: "13:00", end: "15:00", label: "13:00 ~ 15:00" },
  { start: "15:00", end: "17:00", label: "15:00 ~ 17:00" },
  { start: "16:00", end: "18:00", label: "16:00 ~ 18:00" },
] as const;
export const QUARTER_START_TIMES = QUARTER_TIME_SLOTS.map((s) => s.start); // 검증 화이트리스트
```
시그니처: `getLeaveTypeText(t)`, `getLeaveSubTypeText(s)`, `getQuarterEndTime(start)`(11시→"14:00", 그 외 +2h), `getQuarterTimeText(start)`("start~end"), `getFullLeaveText(type, subType?, quarterStartTime?)`. (원본 `C:\workspace\annual-leave\frontend\src\lib\utils.ts` 로직 그대로.)

### SC-6. 라우팅·파일 구조 (탭별 권한)

| 경로 | 탭 | 진입 권한 |
|---|---|---|
| `/leave` | 대시보드 | `leave.request:view` |
| `/leave/request` | 연차 신청 | `leave.request:create` |
| `/leave/history` | 연차 내역 | `leave.request:view`(관리자 전체는 `leave.admin:view`) |
| `/leave/calendar` | 캘린더 | `leave.request:view` |
| `/leave/approvals` | 연차 승인 | `leave.approval:view` |
| `/leave/allocations` | 연차 할당 | `leave.allocation:view` |
| `/leave/status` | 연차 현황 | `leave.status:view` |

```
src/app/(app)/leave/
  layout.tsx              # 가로 탭 바(useCan 필터)
  page.tsx               # 대시보드(기존 단일 페이지 교체)
  request/page.tsx · history/page.tsx · calendar/page.tsx
  approvals/page.tsx · allocations/page.tsx · status/page.tsx
  _components/           # leave-tabs, create-leave-modal, edit-leave-modal, user-select, leave-calendar 등
src/modules/leave/
  labels.ts · services/{dashboard,status,mail}.ts · repositories/mail.ts · mail-templates.ts · authz.ts
src/app/api/leave/{dashboard,mail/drain}/route.ts
src/app/api/admin/leave/{users,approvals,status,status/export}/route.ts
```
기존 `src/app/(app)/admin/leave/{approvals,allocations}/`는 `/leave/*`로 이전(Task 04). 기존 API `/api/admin/leave/*`(requests·allocations·holidays)는 유지.

### SC-7. 테스트 규약

vitest, `tests/`가 `src/` 미러. 기존 `tests/modules/leave/*.test.ts` 패턴 따름. 메일 SMTP는 `setMailTransportForTests`(`@/lib/integrations/mail`)로 fake 주입. 라우트 권한 테스트는 service/repo 레벨 또는 `requirePermission` 모킹으로 fail-closed 검증.

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | schema 필드·메일 outbox·권한 catalog + migration | [ ] | [task-01](2026-06-20-leave-area-redesign/task-01-schema-permissions.md) | — | |
| 02 | labels(표시 헬퍼·QUARTER_TIME_SLOTS) + validation 6종 강화 | [ ] | [task-02](2026-06-20-leave-area-redesign/task-02-labels-validation.md) | — | |
| 03 | 메일 outbox 인프라(repo·drain worker·수신자·drain API) | [ ] | [task-03](2026-06-20-leave-area-redesign/task-03-mail-outbox.md) | 01 | |
| 04 | leave 영역 layout(가로 탭) + admin 페이지 이전 | [ ] | [task-04](2026-06-20-leave-area-redesign/task-04-leave-shell-tabs.md) | 01 | |
| 05 | 권한 경계: 승인 전용 라우트 + 전체이력 leave.admin:view | [ ] | [task-05](2026-06-20-leave-area-redesign/task-05-permission-boundaries.md) | 01 | |
| 06 | 연차 작업 메일 연결 + soft-delete + target 재검증 | [ ] | [task-06](2026-06-20-leave-area-redesign/task-06-mail-wiring-softdelete.md) | 03 | |
| 07 | 관리자 모달(직접입력/수정/삭제) + 사용자목록 API | [ ] | [task-07](2026-06-20-leave-area-redesign/task-07-admin-modals.md) | 02,06 | |
| 08 | 대시보드(service·API·page) | [ ] | [task-08](2026-06-20-leave-area-redesign/task-08-dashboard.md) | 01,02 | |
| 09 | 연차 현황 + 엑셀(service·API·export·page) | [ ] | [task-09](2026-06-20-leave-area-redesign/task-09-status-excel.md) | 01,02 | |
| 10 | 연차 내역(일반/관리자 분기 page) | [ ] | [task-10](2026-06-20-leave-area-redesign/task-10-history.md) | 02,05 | |
| 11 | 연차 전용 캘린더(부서 스코프·APPROVED-only) | [ ] | [task-11](2026-06-20-leave-area-redesign/task-11-calendar.md) | 02,06 | |
| 12 | 신청 폼 보정(반반차 6종·?date prefill) | [ ] | [task-12](2026-06-20-leave-area-redesign/task-12-request-form.md) | 02 | |

권장 실행 순서: 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12.
