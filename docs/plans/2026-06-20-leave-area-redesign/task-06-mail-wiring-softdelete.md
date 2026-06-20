# Task 06 — 연차 작업 메일 연결 + soft-delete + 관리자 귀속 + target 재검증

**목적:** 신청/승인/반려/직접입력 트랜잭션 내부에 outbox `PENDING` 행을 적재하고(커밋=발송 예약), 커밋 후 fire-and-forget drain을 트리거한다. 삭제를 soft-delete(+AuditLog+outbox CANCELLED)로 바꾸고 기본 조회에서 제외한다. 관리자 귀속 필드를 기록하고, 직접입력의 대상 사용자를 서버에서 재검증한다.

## Files
- Create: `src/modules/leave/authz.ts` (assertTargetUser)
- Modify: `src/modules/leave/repositories/index.ts` (tx 함수에 outbox/귀속/soft-delete/deletedAt 필터)
- Modify: `src/modules/leave/services/requests.ts` (수신자·본문·drain 트리거·시그니처)
- Modify: `src/app/api/admin/leave/requests/[id]/route.ts` (PATCH adminId, DELETE reason)
- Modify: `src/app/api/admin/leave/requests/route.ts` (POST sendNotification 전달)
- Modify: `tests/modules/leave/repositories.test.ts` (soft-delete/outbox 케이스 추가)
- Modify: `tests/modules/leave/requests-service.test.ts` (메일/target mock 추가)
- Create: `tests/modules/leave/mail-wiring.test.ts`

## Prep
- 엔트리포인트 §SC-4(outbox 계약: insert idempotent·cancel·수신자), §SC-1(writeAudit).
- Task 03 산출: `insertPendingDelivery(tx, ...)`, `cancelPendingDeliveries(tx, leaveRequestId, now)`, `getLeaveAdminRecipients()`, `drainLeaveMailOutbox()`, templates(`buildRequestNotification`/`buildApprovedNotification`/`buildRejectedNotification`/`buildAdminCreatedNotification`).
- 기존 repository tx 함수(repositories/index.ts): createPendingRequest:63, createApprovedRequestTx:83, approveTx:110, rejectRequest:130, updateByAdminTx:163, deleteByAdminTx:211, listRequests:12, getRequestById:8.
- soft-delete 정합성: status를 `CANCELLED`로 전이하면 기존 status 기반 집계(approve/recalc/overlap=PENDING|APPROVED)가 삭제분을 자동 제외한다. 일반 취소(CANCELLED, deletedAt=null)와 구분은 `deletedAt`로 — 전체상태 조회(listRequests/getRequestById)에만 `deletedAt: null` 필터를 추가한다.

## Deps
Task 03(outbox 인프라). (Task 01 필드는 전제.)

## Steps

### 1. authz 헬퍼
`src/modules/leave/authz.ts`:
```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/kernel/access";

// 직접입력 대상 재검증: 위조 userId 거부(존재·ACTIVE). admin 권한은 **전사 글로벌**이라 부서 대조는 하지 않는다
// (결정 — spec §7: §2 "팀장 승인 흐름 없음"·원본 annual-leave와 동일). 실재·활성 대상이면 전사 대상에 작용 가능.
export async function assertTargetUser(targetUserId: string): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: targetUserId }, select: { status: true } });
  if (!u || u.status !== "ACTIVE") throw new ForbiddenError("대상 사용자가 유효하지 않습니다.");
}
```

### 2. repository — outbox insert·귀속·soft-delete·deletedAt 필터

`repositories/index.ts` 상단 import 추가:
```ts
import { insertPendingDelivery, cancelPendingDeliveries, type MailJob } from "./mail";
import { writeAudit } from "@/kernel/audit";
```
(`MailJob`·`insertPendingDelivery`·`cancelPendingDeliveries`는 Task 03 `repositories/mail.ts`에 이미 정의돼 있다.)

**(a) 조회 필터:** `getRequestById`(line 8)와 `listRequests`(line 12)에 `deletedAt: null` 추가:
```ts
export function getRequestById(id: string) {
  return prisma.leaveRequest.findFirst({ where: { id, deletedAt: null } });
}
export function listRequests(filter: { userId?: string; statuses?: LeaveRequestStatus[] }) {
  return prisma.leaveRequest.findMany({
    where: {
      deletedAt: null,
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}
```

**(b) createPendingRequest** — `mailJob?` 인자 + tx 내 insert(REQUESTED):
```ts
export function createPendingRequest(data: {
  userId: string; leaveType: "ANNUAL" | "HALF" | "QUARTER";
  leaveSubType?: "MORNING" | "AFTERNOON" | null; quarterStartTime?: string | null;
  startDate: Date; endDate: Date; days: number; reason?: string | null;
}, mailJob?: MailJob | null) {
  return prisma.$transaction(async (tx) => {
    await lockUserAndAssertNoOverlap(tx, data.userId, data.startDate, data.endDate);
    const req = await tx.leaveRequest.create({
      data: {
        userId: data.userId, leaveType: data.leaveType,
        leaveSubType: data.leaveType === "HALF" ? data.leaveSubType ?? null : null,
        quarterStartTime: data.leaveType === "QUARTER" ? data.quarterStartTime ?? null : null,
        startDate: data.startDate, endDate: data.endDate, days: data.days,
        reason: data.reason ?? null, status: "PENDING",
      },
    });
    if (mailJob) await insertPendingDelivery(tx, { leaveRequestId: req.id, eventType: "REQUESTED", ...mailJob });
    return req;
  });
}
```

**(c) createApprovedRequestTx** — 귀속(createdByAdminId/At) + ADMIN_CREATED insert. line 95~104의 `data`에 추가하고 끝에 insert:
```ts
      data: {
        userId: data.userId, leaveType: data.leaveType,
        leaveSubType: data.leaveType === "HALF" ? data.leaveSubType ?? null : null,
        quarterStartTime: data.leaveType === "QUARTER" ? data.quarterStartTime ?? null : null,
        startDate: data.startDate, endDate: data.endDate, days: data.days, reason: data.reason ?? null,
        status: "APPROVED", reviewedById: data.adminId, reviewedAt: new Date(),
        createdByAdminId: data.adminId, createdByAdminAt: new Date(),
        adminActionNote: data.adminActionNote ?? "관리자 직접입력",
      },
```
시그니처에 `mailJob?: MailJob | null` 추가, `return tx.leaveRequest.create(...)` 부분을:
```ts
    const created = await tx.leaveRequest.create({ data: { /* 위 */ } });
    if (mailJob) await insertPendingDelivery(tx, { leaveRequestId: created.id, eventType: "ADMIN_CREATED", ...mailJob });
    return created;
```

**(d) approveTx(requestId, adminId, mailJob?)** — mailJob insert + **updatedAt CAS로 stale-days 방지**(finding, high). 시그니처: `export async function approveTx(requestId: string, adminId: string, mailJob?: MailJob | null)`.

`approveTx`는 현재 `req`를 읽고(`status/userId/startDate/days`) `updateMany({where:{id,status:"PENDING"}})` 후 `usedDays += req.days` 한다. PENDING 상태인 신청을 admin이 **수정**할 수 있으므로(updateByAdminTx), approve의 read와 CAS 사이에 days/연도가 바뀌면 status는 PENDING 그대로라 status-only CAS를 통과해 **stale days로 usedDays가 증가**한다(balance drift). 그래서 update/delete와 동일하게 **`updatedAt`을 read select에 추가하고 CAS `where`에 건다**:
```ts
    const req = await tx.leaveRequest.findUnique({
      where: { id: requestId }, select: { status: true, userId: true, startDate: true, days: true, updatedAt: true },
    });
    if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    if (req.status !== "PENDING") throw new LeaveConflictError("이미 처리된 신청입니다.");
    const updated = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: "PENDING", updatedAt: req.updatedAt },
      data: { status: "APPROVED", reviewedById: adminId, reviewedAt: new Date() },
    });
    if (updated.count === 0) throw new LeaveConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
```
   CAS 성공이 `req.days`의 유효성을 보증하므로 이어지는 `usedDays += req.days`가 정확하다(동시 수정 시 0행 충돌로 막힘). tx 종료 전(allocation 증가 후) APPROVED outbox insert:
```ts
    if (mailJob) await insertPendingDelivery(tx, { leaveRequestId: requestId, eventType: "APPROVED", ...mailJob });
```
   (approve 메일 본문은 service가 `getRequestById`로 읽어 구성 — 동시 수정 시 본문이 약간 stale할 수 있으나 알림용이라 best-effort 허용. usedDays 정합성은 위 CAS로 보장.)

**(e) rejectRequest → tx화(requestId, adminId, rejectionReason, mailJob?)** — outbox를 같은 tx로 묶는다:
```ts
export async function rejectRequest(requestId: string, adminId: string, rejectionReason: string, mailJob?: MailJob | null) {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: "REJECTED", reviewedById: adminId, reviewedAt: new Date(), rejectionReason },
    });
    if (updated.count === 0) throw new LeaveConflictError("이미 처리된 신청입니다.");
    if (mailJob) await insertPendingDelivery(tx, { leaveRequestId: requestId, eventType: "REJECTED", ...mailJob });
  });
}
```

**(f) updateByAdminTx** — patch에 `adminId` 추가 + **소프트삭제 가드·낙관적 CAS로 read-then-write race 차단**(finding, high). 시그니처:
```ts
export async function updateByAdminTx(requestId: string, patch: {
  adminId: string; leaveType: "ANNUAL" | "HALF" | "QUARTER"; leaveSubType: "MORNING" | "AFTERNOON" | null;
  quarterStartTime: string | null; startDate: Date; endDate: Date; newDays: number;
  reason: string | null; adminActionNote: string | null;
}) {
```
변경(기존 `update({where:{id}})`(무조건)을 CAS `updateMany`로):
1. 내부 read를 `findUnique({where:{id}})` → **`findFirst({ where: { id: requestId, deletedAt: null }, select: { status: true, userId: true, startDate: true, days: true, updatedAt: true } })`** (소프트삭제 제외 + `updatedAt` 추가). 없으면 `LeaveConflictError`.
2. `lockUserAndAssertNoOverlap`은 그대로(같은 사용자 동시 수정 직렬화).
3. 본문 `update` → **CAS `updateMany`**:
```ts
    const transition = await tx.leaveRequest.updateMany({
      where: { id: requestId, deletedAt: null, status: existing.status, updatedAt: existing.updatedAt },
      data: {
        leaveType: patch.leaveType,
        leaveSubType: patch.leaveType === "HALF" ? patch.leaveSubType : null,
        quarterStartTime: patch.leaveType === "QUARTER" ? patch.quarterStartTime : null,
        startDate: patch.startDate, endDate: patch.endDate, days: patch.newDays,
        reason: patch.reason, adminActionNote: patch.adminActionNote ?? "관리자 수정",
        modifiedByAdminId: patch.adminId, modifiedByAdminAt: new Date(),
      },
    });
    if (transition.count === 0) throw new LeaveConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
```
   `updatedAt`(@updatedAt) 조건이 status 변경(approve/cancel/delete) **과** days 변경(타 admin 수정)을 모두 잡는다 — 0행이면 stale read이므로 보정을 적용하지 않고 충돌로 종료(usedDays 드리프트 방지).
4. usedDays 보정(`existing.status === "APPROVED"`일 때 same-year diff / cross-year)은 **CAS 성공 이후** 기존 로직 그대로 — CAS 성공이 `existing` 스냅샷의 유효성을 보증하므로 delta(`patch.newDays - existing.days`)가 정확.
5. 반환은 `return tx.leaveRequest.findUniqueOrThrow({ where: { id: requestId } })`(갱신된 행).

**(g) deleteByAdminTx → soft-delete(requestId, adminId, reason)**:
```ts
export async function deleteByAdminTx(requestId: string, adminId: string, reason: string | null) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const existing = await tx.leaveRequest.findFirst({
      where: { id: requestId, deletedAt: null }, select: { status: true, userId: true, startDate: true, days: true, updatedAt: true },
    });
    if (!existing) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    const wasApproved = existing.status === "APPROVED";
    // 낙관적 CAS: 관찰한 status·days(=updatedAt)·미삭제일 때만 전이. 0행이면 그 사이 approve/cancel/타 admin 수정/삭제됨
    // → 충돌로 막아 usedDays 정합성 보호(read-then-update race + days-ABA 방지, finding). updatedAt(@updatedAt)이 days 변경도 잡음.
    const transition = await tx.leaveRequest.updateMany({
      where: { id: requestId, deletedAt: null, status: existing.status, updatedAt: existing.updatedAt },
      data: { status: "CANCELLED", deletedByAdminId: adminId, deletedAt: now, deleteReason: reason, cancelledAt: now, cancellationReason: reason ?? "관리자 삭제" },
    });
    if (transition.count === 0) throw new LeaveConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
    // 실제 전이된 status에만 usedDays 보정 — CAS 성공이 곧 APPROVED 유지를 보증(approve와 race 시 위 0행으로 차단됨).
    if (wasApproved) {
      const r = await tx.leaveAllocation.updateMany({
        where: { userId: existing.userId, year: existing.startDate.getUTCFullYear() },
        data: { usedDays: { decrement: existing.days } },
      });
      if (r.count === 0) throw new LeaveConflictError("연차 할당 정보를 찾을 수 없습니다.");
    }
    await cancelPendingDeliveries(tx, requestId, now); // PENDING/FAILED/stale SENDING만 취소(active SENDING은 worker가 정직 finalize — 결정 A)
    await writeAudit(tx, { actorId: adminId, entityType: "LeaveRequest", entityId: requestId, action: "soft_delete", metadata: { reason } });
  });
}
```

### 3. service — 수신자·본문·drain·시그니처

`services/requests.ts` import 추가:
```ts
import { getLeaveAdminRecipients, drainLeaveMailOutbox } from "./mail";
import { buildRequestNotification, buildApprovedNotification, buildRejectedNotification, buildAdminCreatedNotification, type MailReqLike } from "../mail-templates";
import { assertTargetUser } from "../authz";
import { QUARTER_START_TIMES } from "../labels"; // effective-state 교차검증(반반차 화이트리스트)
// `LeaveValidationError`는 기존 requests.ts import에 있으면 재사용, 없으면 `../errors`에서 추가.
```

**(a) createLeaveRequest** — 끝부분 `return createPendingRequest(...)`를 교체:
```ts
  const applicant = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  const recipients = await getLeaveAdminRecipients();
  const reqLike: MailReqLike = { leaveType: input.leaveType, leaveSubType: input.leaveSubType ?? null, quarterStartTime: input.quarterStartTime ?? null, startDate: start, endDate: end, reason: input.reason ?? null };
  // 수신자 0명(승인권한자 없음/조회 저하)이어도 REQUESTED 행은 **항상** 적재 — durable 기록(spec §8). worker가 "수신자 없음" FAILED로 종결해 운영자가 누락을 본다(finding).
  const mailJob = { recipients, ...buildRequestNotification(applicant?.name ?? "직원", reqLike) };
  const created = await createPendingRequest({
    userId, leaveType: input.leaveType, leaveSubType: input.leaveSubType,
    quarterStartTime: input.quarterStartTime, startDate: start, endDate: end, days, reason: input.reason,
  }, mailJob);
  void drainLeaveMailOutbox();
  return created;
```

**(b) createLeaveRequestByAdmin(adminId, targetUserId, input, adminActionNote, sendNotification?)** — 시그니처에 `sendNotification?: boolean` 추가, 함수 시작에 `await assertTargetUser(targetUserId);`, 끝부분:
```ts
  let mailJob = null as ({ recipients: string[]; subject: string; bodyHtml: string } | null);
  if (sendNotification) {
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { email: true } });
    const reqLike: MailReqLike = { leaveType: input.leaveType, leaveSubType: input.leaveSubType ?? null, quarterStartTime: input.quarterStartTime ?? null, startDate: start, endDate: end, reason: input.reason ?? null };
    if (target?.email) mailJob = { recipients: [target.email], ...buildAdminCreatedNotification(reqLike) };
  }
  const created = await createApprovedRequestTx({
    userId: targetUserId, adminId, leaveType: input.leaveType, leaveSubType: input.leaveSubType,
    quarterStartTime: input.quarterStartTime, startDate: start, endDate: end, days, reason: input.reason, adminActionNote,
  }, mailJob);
  if (mailJob) void drainLeaveMailOutbox();
  return created;
```

**(c) approve / reject** — 수신자(신청자) 조회 + mailJob + drain:
```ts
export async function approve(requestId: string, adminId: string) {
  const req = await getRequestById(requestId);
  if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } });
  const mailJob = user?.email ? { recipients: [user.email], ...buildApprovedNotification(req) } : null;
  await approveTx(requestId, adminId, mailJob);
  void drainLeaveMailOutbox();
}
export async function reject(requestId: string, adminId: string, rejectionReason: string) {
  const req = await getRequestById(requestId);
  if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } });
  const mailJob = user?.email ? { recipients: [user.email], ...buildRejectedNotification(req, rejectionReason) } : null;
  await rejectRequest(requestId, adminId, rejectionReason, mailJob);
  void drainLeaveMailOutbox();
}
```
(`rejectRequest`는 기존 `../repositories` import에 이미 있고 service 함수명은 `reject`라 이름 충돌이 없다. service의 `reject`는 repo `rejectRequest`를 호출한다.)
`getRequestById`가 반환하는 LeaveRequest는 `buildApprovedNotification`의 `MailReqLike`(leaveType/leaveSubType/quarterStartTime/startDate/endDate/reason)를 구조적으로 만족한다.

**(d) updateByAdmin(requestId, input, adminId)** — 시그니처에 `adminId` 추가. **부분 patch + 기존 행 fallback으로 만든 effective state를 서버에서 교차검증**(finding, high): update zod 스키마가 부분 patch를 허용하므로, 예컨대 ANNUAL→HALF인데 `leaveSubType` 미전달이면 fallback이 null로 남아 **유효하지 않은 행이 저장**된다. 그래서 effective 값을 계산한 뒤 `updateByAdminTx` 호출 **전에** 검증한다:
```ts
  const effSubType = leaveType === "HALF" ? (input.leaveSubType ?? existing.leaveSubType) : null;
  const effQuarter = leaveType === "QUARTER" ? (input.quarterStartTime ?? existing.quarterStartTime) : null;
  // 교차검증(effective state): HALF엔 leaveSubType, QUARTER엔 화이트리스트 quarterStartTime 필수.
  if (leaveType === "HALF" && !effSubType) throw new LeaveValidationError("반차는 오전/오후 구분이 필요합니다.");
  if (leaveType === "QUARTER" && (!effQuarter || !QUARTER_START_TIMES.includes(effQuarter))) {
    throw new LeaveValidationError("반반차는 허용된 시간대(6종) 중 하나가 필요합니다.");
  }
  return updateByAdminTx(requestId, {
    adminId,
    leaveType,
    leaveSubType: effSubType,
    quarterStartTime: effQuarter,
    startDate: start, endDate: end, newDays,
    reason: input.reason !== undefined ? input.reason : existing.reason,
    adminActionNote: input.adminActionNote ?? null,
  });
```
import 추가: `LeaveValidationError`(`../errors`), `QUARTER_START_TIMES`(`../labels`, Task 02). (`newDays`도 effective type/날짜로 재계산되는 기존 로직을 따른다 — QUARTER/HALF는 단일일.)

**(e) deleteByAdmin(requestId, adminId, reason)**:
```ts
export function deleteByAdmin(requestId: string, adminId: string, reason: string | null) {
  return deleteByAdminTx(requestId, adminId, reason);
}
```

### 4. 라우트 시그니처 반영
- `api/admin/leave/requests/route.ts` POST: `const { userId, sendNotification, ...input } = parsed.data;` → `createLeaveRequestByAdmin(session.user.id, userId, input, null, sendNotification)`.
- `api/admin/leave/requests/[id]/route.ts` PATCH: `updateByAdmin(id, parsed.data, session.user.id)`.
- 동 DELETE: body에서 reason 파싱 후 `deleteByAdmin(id, session.user.id, reason)`:
```ts
  let reason: string | null = null;
  try { const b = await _req.json(); reason = typeof b?.reason === "string" ? b.reason : null; } catch { /* body 없음 허용 */ }
  await requirePermission(session.user.id, "leave.request", "delete");
  await deleteByAdmin(id, session.user.id, reason);
```
(`_req`를 `req`로 바꿔 body를 읽는다.)

### 5. 테스트
- `tests/modules/leave/repositories.test.ts`(기존 — **시그니처 변경 반영 필수**): hoisted db에 `leaveRequest.findFirst`(이미 있음)·`mailDelivery: { create: vi.fn() }`·`auditLog: { create: vi.fn() }` 추가, `vi.mock("@/kernel/audit", () => ({ writeAudit: vi.fn() }))`, `vi.mock("@/modules/leave/repositories/mail", () => ({ insertPendingDelivery: vi.fn(), cancelPendingDeliveries: vi.fn() }))`.
  - **기존 케이스 갱신:** `updateByAdminTx`의 `patch` 객체에 `adminId: "admin1"` 추가(타입 필수). `updateByAdminTx`·`deleteByAdminTx`의 내부 read가 `findUnique`→`findFirst`(deletedAt:null, **select에 `updatedAt` 포함**)로 바뀐 점 반영(`h.db.leaveRequest.findFirst.mockResolvedValue({ ..., updatedAt: new Date(...) })`). 둘 다 전이를 `update`가 아니라 **`updateMany`(CAS)**로 하므로 `h.db.leaveRequest.updateMany`로 모킹(count로 CAS 성공/충돌 제어). `updateByAdminTx`는 끝에 `findUniqueOrThrow`로 갱신행 반환 → `h.db.leaveRequest.findUniqueOrThrow` 모킹 추가. `deleteByAdminTx("r1")`→`deleteByAdminTx("r1", "admin1", null)`.
  - **신규 케이스:** createPendingRequest(base, mailJob) → `insertPendingDelivery` 호출(eventType REQUESTED), mailJob 없으면 미호출.
  - **신규 케이스(delete):** 정상 → `leaveRequest.updateMany`가 `where`에 `status`+`updatedAt`(CAS)·`deletedAt: null` 포함, `data`에 `deletedAt`/`status: "CANCELLED"` 포함 + `cancelPendingDeliveries(tx, "r1", <now>)`(now 인자 포함)·`writeAudit` 호출; **CAS 충돌**(updateMany count 0) → `LeaveConflictError`("처리 중 상태 변경") 그리고 `leaveAllocation.updateMany` **미호출**(보정 안 함); 이미 삭제분(findFirst null) → `LeaveConflictError`; APPROVED 삭제만 `leaveAllocation` decrement.
  - **신규 케이스(update CAS):** 정상 APPROVED 수정 → `leaveRequest.updateMany` `where`에 `status`+`updatedAt` 포함하고 usedDays 보정(diff) 호출; **CAS 충돌**(updateMany count 0, 동시 approve/타 admin 수정 모사) → `LeaveConflictError`이고 `leaveAllocation.updateMany` **미호출**(stale read로 보정 안 됨).
  - **기존 케이스 갱신(approveTx):** `approveTx`의 `findUnique` mock select에 `updatedAt` 포함, `updateMany` `where`에 `status: "PENDING"`+`updatedAt` 포함 단언. **신규 케이스:** 동시 수정 모사(updateMany count 0) → `LeaveConflictError`이고 `leaveAllocation.updateMany`(usedDays increment) **미호출**(stale days로 증가 안 됨). 시그니처에 `mailJob?` 추가 반영.
- `tests/modules/leave/mail-wiring.test.ts`: service 레벨 — `vi.mock("@/modules/leave/services/mail", () => ({ getLeaveAdminRecipients: vi.fn(async () => ["a@x.com"]), drainLeaveMailOutbox: vi.fn() }))`, repo·prisma·templates 사용. 케이스:
  - createLeaveRequest → createPendingRequest가 mailJob(recipients 포함)과 함께 호출, drain 호출됨.
  - **createLeaveRequest(승인권한자 0명, getLeaveAdminRecipients→[])** → createPendingRequest가 여전히 mailJob(`recipients: []`)과 함께 호출됨(REQUESTED 행 항상 적재; null 아님 — finding).
  - createLeaveRequestByAdmin(sendNotification=false) → mailJob null, drain 미호출; (true) → ADMIN_CREATED mailJob + drain.
  - assertTargetUser: 비활성/없는 user면 ForbiddenError.
- `tests/modules/leave/requests-service.test.ts`: 기존 케이스가 깨지지 않게 `services/mail`·`mail-templates`·`authz`·`@/lib/prisma`(user.findUnique) mock 보강. 기존 단언 유지. **신규(effective-state 교차검증, finding):** `updateByAdmin`에 existing=ANNUAL 행으로 `leaveType: "HALF"`만(leaveSubType 미전달) → `LeaveValidationError`이고 `updateByAdminTx` 미호출; `leaveType: "QUARTER"`만(quarterStartTime 미전달/비화이트리스트) → `LeaveValidationError`; 올바른 입력(HALF+leaveSubType, QUARTER+화이트리스트 시각) → 정상 호출.

## Acceptance Criteria
- `npm test` → 전체 green(기존 + 신규).
- `npm run typecheck` / `npm run lint` / `npm run build` → 통과.
- 코드 점검: 4개 이벤트(REQUESTED/APPROVED/REJECTED/ADMIN_CREATED) 모두 tx **내부**에서 insert, 커밋 후 `void drainLeaveMailOutbox()`; 삭제는 물리삭제 아님(`deletedAt` set + AuditLog + outbox cancel).
- 코드 점검: `approveTx`·`deleteByAdminTx`·`updateByAdminTx` 전이가 모두 **낙관적 CAS**(`updateMany` `where`에 `status`+`updatedAt`, count 0 충돌)이고 usedDays 보정은 CAS 성공 이후에만 적용.
- 코드 점검: `cancelPendingDeliveries`는 **`PENDING`/`FAILED`/stale `SENDING`(lockedUntil < now)만** CANCELLED로 하고 **active SENDING(lease 유효)은 건드리지 않는다**(결정 A — worker가 정직하게 finalize). active SENDING 행이 그대로 남는 테스트 포함.

## Cautions
- **Don't** outbox insert를 tx 밖(커밋 후)에서 하지 마라. 이유: 커밋과 발송 예약이 원자적이지 않으면 "커밋됐는데 메일 행 없음"이 생긴다(spec §8 트랜잭션 계약).
- **Don't** `drainLeaveMailOutbox()`를 `await`하지 마라. 이유: 발송 지연/실패가 연차 API 응답을 막으면 안 된다(연차 도메인 불변식). `void`로 fire-and-forget.
- **Don't** soft-delete에서 물리 `delete`를 남기지 마라. 이유: ops-hub 감사 원칙(deletedBy/At·사유·AuditLog 보존).
- **Don't** `recalculateUsedDaysTx`/`sumPendingDays`/overlap에 `deletedAt` 필터를 추가하지 마라. 이유: soft-delete가 status를 `CANCELLED`로 바꾸므로 status 필터로 이미 제외된다(중복·과조정 방지). `deletedAt` 필터는 전체상태 조회(listRequests/getRequestById)에만.
- **Don't** 관리자 직접입력에서 `assertTargetUser`를 건너뛰지 마라. 이유: 드롭다운 우회 위조 userId를 막는다(존재·ACTIVE 재검증). admin은 전사 글로벌이라 부서 대조는 없지만, 실재·활성 검증은 필수(spec §7).
- **Don't** `deleteByAdminTx`·`updateByAdminTx` 전이를 `update({where:{id}})`(무조건)로 하지 마라. 이유: status/days를 읽고→무조건 update하면 approve/cancel/타 admin 수정과 race 시 usedDays가 어긋난다(finding, high). 둘 다 **CAS `updateMany`**로 `where`에 `status`+`updatedAt`(낙관적 락)을 걸고 0행이면 충돌로 종료한 뒤, usedDays 보정은 CAS 성공 이후에만 적용한다. (`updatedAt`은 status 불변·days만 바뀐 동시 수정의 ABA까지 잡는다.)
