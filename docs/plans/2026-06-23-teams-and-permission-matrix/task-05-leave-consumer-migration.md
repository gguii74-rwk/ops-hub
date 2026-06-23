# task-05 — 연차 소비처 이행(캘린더 teamId + 승인 scope-aware + 알림 수신자)

**목적:** 연차 도메인의 `department` reader를 `teamId`로 전환하고, **`leave.approval`을 scope-aware로 강제**한다(D12 ①②④): 승인 목록=`getEffectiveScope`, 승인/거절 액션=`requirePermissionForTarget(target=신청자.teamId)`, 알림 수신자=all-scope + 같은 팀 team-scope + 팀장.

## Files
- Modify: `src/modules/leave/services/calendar.ts` (department→teamId 전수)
- Modify: `src/app/api/leave/calendar/route.ts` (`filterDepartment`→`filterTeamId`)
- Modify: `src/modules/leave/services/requests.ts` (list select teamId + `listApprovalQueue` 신설 + approve/reject 액션 target 가드 + enqueue recipients(teamId))
- Modify: `src/modules/leave/repositories/index.ts` (`approveTx`/`rejectRequest`가 트랜잭션 내부에서 신청자 팀을 FOR UPDATE 잠금·재점검 — F-B TOCTOU 원자화)
- Modify: `src/modules/leave/services/mail.ts` (`getLeaveAdminRecipients(applicantTeamId)`)
- Modify: `src/app/api/admin/leave/approvals/route.ts` (scope-aware 목록)
- Modify: `src/app/api/admin/leave/requests/[id]/approve/route.ts`·`reject/route.ts` (서비스가 target 가드 — 라우트 requirePermission 제거)
- Modify: `src/modules/leave/services/status.ts` (department→teamId/teamName)
- Modify: `src/modules/leave/services/users.ts` (`listActiveUsers` select teamId)
- Modify: `src/app/api/admin/leave/status/export/route.ts` (부서→팀 컬럼)
- Modify: `src/app/(app)/leave/_components/{status-client,admin-history,user-select}.tsx`, `src/app/(app)/leave/manage/approvals-client.tsx` (teamName 표시)
- Modify: `src/app/(app)/leave/history/page.tsx`, `src/app/(app)/leave/calendar/page.tsx` (직접입력 버튼 게이트를 effective-scope-all로 — F-G)
- Modify (tests): `tests/modules/leave/{calendar-service,status-service,list-with-user,requests-service,mail-wiring,mail-drain}.test.ts`, `tests/app/api/leave/calendar-route.test.ts`, `tests/app/components/history-page.test.ts`

## Prep
- 엔트리포인트 §Shared Contracts "scope 엔진", "목록 필터 패턴(F9)", "PD2".
- task-02: `getEffectiveScope`/`requirePermissionForTarget`. task-01: teamId/team.
- 기존: `calendar.ts`(department 매칭), `requests.ts`(`listAllRequestsWithUser`·`approve`/`reject`), `mail.ts`(`getLeaveAdminRecipients`).

## Deps
01 (teamId), 02 (scope 엔진).

## Steps

### 1. calendar.ts — department→teamId (실패 테스트 먼저)

> **§7 row 3 해석(PD2 정합):** spec §7 row 3은 "teamId 매칭 + scope를 getEffectiveScope에서 도출"이라 적었지만, 연차 캘린더는 `leave.request:view`(all-scope `requirePermission`)로 가드되고 `calendar.leave`/`leave.request`는 **non-scopeable**(PD2)이다. 따라서 cross-team 능력은 기존대로 `leave.status:view`/`leave.admin:view`(all-scope 키, 라우트가 `getPermissionSummary`로 도출)에서 가져오고, **department→teamId 필드 치환만** 한다. `calendar.leave`에 team scope를 부여하면 통합 피드(`/api/calendar/feed`)에서 F5가 재발하므로 getEffectiveScope를 여기 끼우지 않는다.

`tests/modules/leave/calendar-service.test.ts`의 department 매칭 단언을 teamId로 바꾼다(아래 반영) → 실행 → **FAIL**.

`src/modules/leave/services/calendar.ts` 전체 교체(department→teamId, canCrossDepartment→canCrossTeam, filterDepartment→filterTeamId):
```ts
import "server-only";
import { prisma } from "@/lib/prisma";

export interface LeaveCalendarEvent {
  id: string; userId: string; name: string; leaveType: string;
  leaveSubType: string | null; quarterStartTime: string | null;
  startDate: Date; endDate: Date; status: string; reason: string | null; isSelf: boolean;
}

export async function getLeaveCalendar(params: {
  viewerId: string;
  canViewAllStatuses: boolean; // admin:view — 전 상태 + 타인 상세 마스킹 해제
  canCrossTeam: boolean;       // status:view 또는 admin:view — 팀 경계 없이 타인 조회
  start: Date;
  end: Date;
  filterTeamId?: string | null;
}): Promise<LeaveCalendarEvent[]> {
  const { viewerId, canViewAllStatuses, canCrossTeam, start, end } = params;
  const rangeAnd = [{ startDate: { lte: end } }, { endDate: { gte: start } }];

  // 팀 필터 → ACTIVE userId 목록. 팀 경계 권한자(status/admin)만 사용.
  let teamIds: string[] | null = null;
  if (canCrossTeam && params.filterTeamId) {
    const us = await prisma.user.findMany({
      where: { teamId: params.filterTeamId, status: "ACTIVE" },
      select: { id: true },
    });
    teamIds = us.map((u) => u.id);
  }

  let where: Record<string, unknown>;
  if (canViewAllStatuses) {
    where = { deletedAt: null, AND: rangeAnd, ...(teamIds ? { userId: { in: teamIds } } : {}) };
  } else if (canCrossTeam) {
    const others = teamIds
      ? { userId: { in: teamIds.filter((id) => id !== viewerId) }, status: "APPROVED" as const }
      : { userId: { not: viewerId }, status: "APPROVED" as const };
    where = { deletedAt: null, AND: rangeAnd, OR: [{ userId: viewerId }, others] };
  } else {
    // 일반: 본인(전 상태) + 같은 팀 타인(APPROVED). 팀 null/빈 → self-only fail-closed(F9 동형).
    const me = await prisma.user.findUnique({ where: { id: viewerId }, select: { teamId: true } });
    const teamId = me?.teamId ?? null;
    let teamOthers: string[] = [];
    if (teamId) {
      const us = await prisma.user.findMany({
        where: { teamId, status: "ACTIVE", id: { not: viewerId } },
        select: { id: true },
      });
      teamOthers = us.map((u) => u.id);
    }
    where = {
      deletedAt: null, AND: rangeAnd,
      OR: [{ userId: viewerId }, ...(teamOthers.length ? [{ userId: { in: teamOthers }, status: "APPROVED" as const }] : [])],
    };
  }

  const rows = await prisma.leaveRequest.findMany({
    where,
    select: { id: true, userId: true, leaveType: true, leaveSubType: true, quarterStartTime: true, startDate: true, endDate: true, status: true, reason: true },
    orderBy: { startDate: "asc" },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return rows.map((e) => {
    const isSelf = e.userId === viewerId;
    const masked = !isSelf && !canViewAllStatuses;
    return {
      id: e.id, userId: e.userId, name: nameById.get(e.userId) ?? "직원",
      leaveType: e.leaveType,
      leaveSubType: masked ? null : (e.leaveSubType ?? null),
      quarterStartTime: masked ? null : (e.quarterStartTime ?? null),
      startDate: e.startDate, endDate: e.endDate, status: e.status,
      reason: masked ? null : (e.reason ?? null), isSelf,
    };
  });
}
```

`src/app/api/leave/calendar/route.ts`: `canCrossDepartment`→`canCrossTeam`, `filterDepartment`→`filterTeamId`, query param `department`→`teamId`:
```ts
    const canCrossTeam = canViewAllStatuses || keys.has("leave.status:view");
    const events = await getLeaveCalendar({
      viewerId: session.user.id, canViewAllStatuses, canCrossTeam, start, end,
      filterTeamId: canCrossTeam ? url.searchParams.get("teamId") : null,
    });
```
(`canViewAllStatuses` 도출은 그대로.)

### 2. requests.ts — list select teamId + 승인 목록 scope + 액션 target 가드

`src/modules/leave/services/requests.ts`:

**(a) listAllRequestsWithUser**(줄 107) select에 teamId/team 추가:
```ts
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, teamId: true, team: { select: { name: true } }, email: true } })
```
매핑(줄 110)은 `...i, user`에 teamId/team이 그대로 포함. 표시용 teamName이 필요한 소비처는 `user.team?.name`로 접근(approvals-client/admin-history).

**(b) 승인 목록 scope-aware** — 신설:
```ts
import { getEffectiveScope, requirePermissionForTarget, ForbiddenError } from "@/kernel/access";
// ...
// 승인 큐(scope-aware, D12①·F9). all=전체 PENDING, team=신청자 teamId가 actor teamId와 같은 것만, 무소속 team-scope→거부.
export async function listApprovalQueue(actorId: string) {
  const scope = await getEffectiveScope(actorId, "leave.approval", "view");
  if (!scope) throw new ForbiddenError("leave.approval:view 권한이 없습니다.");
  const items = await listAllRequestsWithUser({ statuses: ["PENDING"] });
  if (scope === "all") return items;
  // team
  const me = await prisma.user.findUnique({ where: { id: actorId }, select: { teamId: true } });
  if (me?.teamId == null) throw new ForbiddenError("팀 소속이 없어 승인 대기 목록을 볼 수 없습니다."); // F9
  return items.filter((i) => (i.user as { teamId?: string | null } | null)?.teamId === me.teamId);
}
```

**(c) approve/reject 액션 target 가드 — 상태변경과 원자화(F-B TOCTOU)**: 팀 소속은 본 feature에서 가변(admin 재배정, task-04)이라, target authz(신청자 팀 점검)와 상태 CAS가 **분리**되면 그 사이 재배정으로 team-scope 승인자가 더 이상 자기 팀이 아닌 신청을 승인/거절할 수 있다. → ① 사전 평가로 빠른 거부(scope null·무소속 team-scope F9), ② **권위 점검은 `approveTx`/`rejectRequest` 트랜잭션 내부에서 신청자 행을 `FOR UPDATE`로 잠그고 재확인**해 재배정이 끼어들지 못하게 한다.

신설 헬퍼(서비스). **2단 점검**: ① `requirePermissionForTarget`로 사전 빠른 거부(D12②, 빠른 403), ② **권위 결정은 트랜잭션 내부에서 actor·applicant 두 user 행을 잠그고 현재 팀을 비교**(F-D 원자 — 팀 소속이 가변이라 actor·applicant **둘 다** 재배정 race 대상). precomputed teamId는 권위로 쓰지 않는다(stale actor 방지). 두 번의 `getEffectiveScope`는 16명 규모 admin 액션에서 무해 — 명료성 우선.
```ts
import { getEffectiveScope, requirePermissionForTarget, ForbiddenError } from "@/kernel/access";
import { approveTx, rejectRequest } from "../repositories";
// 승인 scope 사전 평가(빠른 거부용). all/team만 진행, null/own은 거부. team의 팀 일치 권위는 (c-1) tx 내부에서.
async function resolveApprovalScope(adminId: string): Promise<"all" | "team"> {
  const scope = await getEffectiveScope(adminId, "leave.approval", "approve");
  if (scope === "all" || scope === "team") return scope;
  throw new ForbiddenError("leave.approval:approve 권한이 없습니다."); // null/own(leave.approval은 own 미사용)
}

export async function approve(requestId: string, adminId: string) {
  const req = await getRequestById(requestId);
  if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true, teamId: true } });
  await requirePermissionForTarget(adminId, "leave.approval", "approve", { teamId: user?.teamId ?? null }); // D12② 사전 빠른 거부(F9 포함)
  const scope = await resolveApprovalScope(adminId);                 // tx에 넘길 scope("all"|"team")
  const mailJob = user?.email ? toMailJob([user.email], buildApprovedNotification(req)) : null;
  await approveTx(requestId, adminId, mailJob, { actorId: adminId, applicantId: req.userId, scope }); // 권위 재점검은 tx 내부(F-D)
  triggerLeaveMailDrain();
}
export async function reject(requestId: string, adminId: string, rejectionReason: string) {
  const req = await getRequestById(requestId);
  if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true, teamId: true } });
  await requirePermissionForTarget(adminId, "leave.approval", "approve", { teamId: user?.teamId ?? null }); // 거절도 approve 권한·target
  const scope = await resolveApprovalScope(adminId);
  const mailJob = user?.email ? toMailJob([user.email], buildRejectedNotification(req, rejectionReason)) : null;
  await rejectRequest(requestId, adminId, rejectionReason, mailJob, { actorId: adminId, applicantId: req.userId, scope });
  triggerLeaveMailDrain();
}
```
(`ApprovalAuthz`는 `src/modules/leave/repositories/index.ts`에 단일 정의·export, 서비스가 import. 사전 `requirePermissionForTarget`은 빠른 403, **권위 결정은 (c-1) in-tx actor+applicant 재점검**.)

**(c-1) repositories `approveTx`/`rejectRequest` — 트랜잭션 내부 권위 점검(F-D)**: `ApprovalAuthz` 타입을 여기서 정의·export하고, 기존 status-CAS 트랜잭션에 인자 `authz: ApprovalAuthz`를 추가해 **상태 `updateMany` 직전**에 actor·applicant 두 행을 잠그고 **현재** 팀을 비교한다(precomputed teamId 미사용 — actor·applicant 둘 다 재배정 race 차단):
```ts
import { ForbiddenError } from "@/kernel/access";
export type ApprovalAuthz = { actorId: string; applicantId: string; scope: "all" | "team" };

// approveTx/rejectRequest 시그니처에 authz 추가: approveTx(requestId, adminId, mailJob, authz), rejectRequest(requestId, adminId, reason, mailJob, authz).
// 트랜잭션 본문(prisma.$transaction(async (tx) => { ... })) 안, 상태 전이 전:
if (authz.scope === "team") {
  // actor·applicant 행을 **id 정렬 순서**로 각각 FOR UPDATE 잠금 — 두 동시 승인이 같은 두 행을 반대로 잠그는 deadlock 회피.
  // 잠근 뒤 **현재** teamId를 읽어 비교(재배정이 이 tx 커밋 전까지 끼어들지 못함, Read Committed에서도 원자).
  const [first, second] = [authz.actorId, authz.applicantId].sort();
  await tx.$queryRaw`SELECT 1 FROM "kernel"."User" WHERE "id" = ${first} FOR UPDATE`;
  if (second !== first) await tx.$queryRaw`SELECT 1 FROM "kernel"."User" WHERE "id" = ${second} FOR UPDATE`;
  const rows = await tx.$queryRaw<Array<{ id: string; teamId: string | null }>>`
    SELECT "id", "teamId" FROM "kernel"."User" WHERE "id" IN (${authz.actorId}, ${authz.applicantId})`;
  const actorTeam = rows.find((r) => r.id === authz.actorId)?.teamId ?? null;
  const applicantTeam = rows.find((r) => r.id === authz.applicantId)?.teamId ?? null;
  if (actorTeam == null || actorTeam !== applicantTeam) {
    throw new ForbiddenError("해당 신청에 대한 승인 권한이 없습니다."); // 롤백 — 상태 변경·메일 enqueue 안 됨
  }
}
// all-scope는 점검 생략. 이어서 기존 updateMany({where:{id,status:'PENDING'}}) status-CAS 수행.
```
(`ForbiddenError` import 추가. 트랜잭션 내부에서 throw하면 status CAS·`MailDelivery` enqueue 모두 롤백되어 부분 실행이 없다. scope 자체 변경(role/override)은 OWNER 전용·본 feature 가변 표면 밖이라 precheck scope를 신뢰; 가변 teamId만 tx에서 재독.)

**(c2) getRequest 단건 상세 target-aware**(줄 113-124 · PD3·F2 필수): `getPermissionSummary`가 any-scope가 되면 `ctx.permissionKeys.has("leave.approval:view")`가 team-scope 승인자에게도 true라 **타 팀 PENDING 단건 상세가 샌다**. canViewPending 경로를 scope-aware로 교체:
```ts
export async function getRequest(id: string, ctx: LeaveCtx) {
  const req = await getRequestById(id);
  if (!req) return null;
  if (req.userId === ctx.userId) return req;                       // 본인 → 전 상태
  if (ctx.isOwner || ctx.permissionKeys.has("leave.admin:view")) return req; // 전체이력 권한 → 전 상태(all-only 키)
  if (req.status === "PENDING") {
    // 승인 큐 권한은 scope-aware: all=모든 PENDING, team=신청자 팀이 viewer 팀과 같을 때만(PD3 — summary 과허가 차단).
    const scope = await getEffectiveScope(ctx.userId, "leave.approval", "view");
    if (scope === "all") return req;
    if (scope === "team") {
      const [applicant, me] = await Promise.all([
        prisma.user.findUnique({ where: { id: req.userId }, select: { teamId: true } }),
        prisma.user.findUnique({ where: { id: ctx.userId }, select: { teamId: true } }),
      ]);
      if (me?.teamId != null && applicant?.teamId === me.teamId) return req; // 무소속(null)·타 팀 → 거부(F9)
    }
  }
  throw new ForbiddenError("본인 신청만 조회할 수 있습니다.");
}
```
(기존 `canViewAll`/`canViewPending` 두 줄을 위 블록으로 교체. `getEffectiveScope`는 이미 import(2b).)

**(d) enqueue recipients(applicant teamId)**(줄 53-56): 신청자 teamId를 조회해 넘긴다:
```ts
  const applicant = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, teamId: true } });
  // ...
  const recipients = await getLeaveAdminRecipients(applicant?.teamId ?? null);
```
(기존 `applicant`가 name만 select하면 teamId 추가. SSOT는 drain 재확정.)

### 3. mail.ts — getLeaveAdminRecipients(applicantTeamId)

`src/modules/leave/services/mail.ts`:
```ts
import { getEffectiveScope } from "@/kernel/access";   // hasPermission import는 다른 용도 없으면 제거
// ...
// 통지 수신자(REQUESTED): all-scope 승인자 + 신청자와 같은 팀의 team-scope 승인자 + 팀장(D12④).
// scope-aware로 재확정(발송 시점 SSOT). 무소속 신청(applicantTeamId=null)은 all-scope 승인자만.
export async function getLeaveAdminRecipients(applicantTeamId: string | null): Promise<string[]> {
  const candidates = await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, email: true, teamId: true } });
  const emails = new Set<string>();
  await Promise.all(candidates.map(async (u) => {
    if (!u.email) return;
    const scope = await getEffectiveScope(u.id, "leave.approval", "view");
    if (scope === "all") emails.add(u.email);
    else if (scope === "team" && applicantTeamId != null && u.teamId === applicantTeamId) emails.add(u.email);
  }));
  // 팀장(D12④) — 불변식상 lead ∈ 그 팀 active 소속원(F3). 비활성/무효 lead는 제외.
  if (applicantTeamId != null) {
    const team = await prisma.team.findUnique({ where: { id: applicantTeamId }, select: { lead: { select: { email: true, status: true } } } });
    if (team?.lead?.status === "ACTIVE" && team.lead.email) emails.add(team.lead.email);
  }
  return [...emails];
}
```

`drainLeaveMailOutbox`(줄 50·65): req select에 userId 추가, REQUESTED 재확정 시 applicant teamId 조회:
```ts
      const req = await prisma.leaveRequest.findUnique({ where: { id: claimed.leaveRequestId }, select: { deletedAt: true, status: true, userId: true } });
      // ... 기존 deletedAt/status 가드 유지 ...
      if (claimed.eventType === "REQUESTED") {
        const applicant = await prisma.user.findUnique({ where: { id: req.userId }, select: { teamId: true } });
        recipients = await getLeaveAdminRecipients(applicant?.teamId ?? null);
      }
```

### 4. approvals route — scope-aware 목록

`src/app/api/admin/leave/approvals/route.ts`: requirePermission 제거(서비스가 gate):
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listApprovalQueue } from "@/modules/leave/services/requests";
import { mapError } from "@/app/api/leave/_shared";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const items = await listApprovalQueue(session.user.id); // getEffectiveScope 게이트 내장(all/team/F9)
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
```

### 5. approve/reject routes — 서비스가 target 가드

`approve/route.ts`·`reject/route.ts`에서 `await requirePermission(session.user.id, "leave.approval", "approve");` **삭제**(서비스 `approve`/`reject`가 `requirePermissionForTarget`로 target 점검). import도 정리. 예 — approve:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { approve } from "@/modules/leave/services/requests";
import { mapError } from "@/app/api/leave/_shared";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    await approve(id, session.user.id); // target(신청자 팀) 가드는 서비스 내부
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
```
(reject도 동일하게 requirePermission 제거, `reject(id, userId, reason)` 호출.)

### 5b. 직접입력(create+자동승인) = all-scope 전용 — UI 게이트 정합(F-G)

`leave.approval:approve`가 scopeable(team)이 되면 any-scope `getPermissionSummary`가 team-scope 승인자에게도 키를 노출한다. 그런데 **직접입력**(`POST /api/admin/leave/requests` 자동승인 + 대상 picker `/api/admin/leave/users`)은 임의 사용자에 대한 create+자동승인이라 **본 증분에서 scope-aware로 이행하지 않는다**(create 흐름 전체를 team으로 좁히는 건 OUT — 승인 큐만 team). 두 라우트는 **all-scope `requirePermission(leave.approval, approve)` 유지**(이미 그러함, fail-closed). 따라서 **직접입력 UI 트리거를 summary 키가 아니라 effective scope=all로 게이트**해 team-scope 승인자에게 버튼이 보였다가 403나는 불일치(F5-class)를 막는다.

- `src/app/(app)/leave/history/page.tsx`(줄 16): `canApprove={set.has("leave.approval:approve")}` → `canApprove={(await getEffectiveScope(session.user.id, "leave.approval", "approve")) === "all"}` (admin-history에서 canApprove는 직접입력 버튼 게이트 전용 — 줄 109).
- `src/app/(app)/leave/calendar/page.tsx`(줄 11): `canManage={set.has("leave.approval:approve")}` → `canManage={(await getEffectiveScope(session.user.id, "leave.approval", "approve")) === "all"}` (LeaveCalendar의 "+ 연차 입력" 게이트).
- `getEffectiveScope` import 추가. **라우트는 변경 없음**(all-scope 유지가 정답 — team-scope 승인자는 직접입력 불가, 승인 큐로만 자기 팀 처리).

(이렇게 하면 team-scope 승인자: 승인 큐·승인 액션 O / 직접입력 버튼 미노출·라우트 403 — 일관. all-scope 승인자: 둘 다 O.)

### 6. status.ts / users.ts / export — teamId/teamName

**status.ts**: `EmployeeStatus.department` → `teamName: string | null`; select `department: true` → `teamId: true, team: { select: { name: true } }`; 매핑 `department: u.department` → `teamName: u.team?.name ?? null`.

**users.ts**: `listActiveUsers` select `department: true` → `teamId: true, team: { select: { name: true } }`(task-03 page가 teamId 사용 + 표시 teamName).

**status/export/route.ts**(줄 21·28): 컬럼 헤더 `{ header: "부서", key: "department" }` → `{ header: "팀", key: "teamName" }`; row 매핑 `department: r.department ?? "-"` → `teamName: r.teamName ?? "-"`.

### 7. leave UI — teamName 표시

- **status-client.tsx**(줄 13·40·44·113): `department` → `teamName`(필터·표시). 필드명 일괄 치환.
- **admin-history.tsx**(줄 31·72·136): `user.department` → `user.team?.name`(list-with-user가 team 포함). 인터페이스 `user: { name; team: { name } | null } | null` 또는 `teamName`.
- **user-select.tsx**(줄 7·41): `department` → `teamName`(또는 `team?.name`).
- **approvals-client.tsx**(줄 15): `user: { ...; department } ` → `user: { ...; team: { name } | null }` 또는 `teamName`; 표시부 갱신.

### 8. 테스트 전수 전환
연차 도메인 테스트 8개의 department 참조를 teamId/teamName으로 치환. 특히:
- `calendar-service.test.ts`: filterTeamId/teamId 매칭 케이스.
- `requests-service.test.ts`·`mail-wiring`·`mail-drain`: `getLeaveAdminRecipients`가 인자(applicantTeamId)를 받도록 호출 갱신 + team-scope 승인자/팀장 포함 케이스.
- **보안 negative(F9·F3·PD3·F-D 필수 — 신규 케이스 추가)**:
  - team-scope 승인자가 자기 팀 PENDING만 `listApprovalQueue`에 보임, 타 팀은 제외.
  - team-scope 승인자가 타 팀 신청 `approve` → ForbiddenError(사전 `requirePermissionForTarget`).
  - 무소속(teamId null) team-scope 승인자 `listApprovalQueue` → ForbiddenError(F9).
  - **getRequest(PD3):** team-scope 승인자가 **자기 팀** PENDING 단건은 조회 OK, **타 팀** PENDING 단건은 ForbiddenError(any-scope summary 과허가 차단). all-scope는 둘 다 OK.
  - **F-G 직접입력 all-scope 게이트(필수):** team-scope `leave.approval:approve` 보유자 → history/calendar page의 `canApprove`/`canManage`가 **false**(effective scope ≠ "all" → 직접입력 버튼 미노출). all-scope면 true. (페이지 단위 테스트 — `getEffectiveScope` mock.) 라우트 자체는 all-scope 유지라 team-scope → 403(기존 가드, 회귀 확인).
  - **F-D 원자 재점검(필수 — actor·applicant 둘 다):** `approveTx`/`rejectRequest`에 `authz={actorId,applicantId,scope:"team"}`를 주고, in-tx 잠금 조회(`$queryRaw` mock)가 반환하는 **현재** 팀으로:
    - actor "A" / applicant "A" → 정상 진행(status `updateMany` 호출).
    - **applicant 재배정** actor "A" / applicant "B" → ForbiddenError, status/메일 미호출.
    - **actor 재배정**(precheck 이후 actor가 A→B) actor "B" / applicant "A" → ForbiddenError(stale actor 권위 사용 안 함 — F-D 핵심), status/메일 미호출.
    - `scope:"all"` → 잠금 조회 자체를 건너뛰고 정상 진행.
    부분 실행이 없음(tx throw → status CAS·`MailDelivery` create 롤백)을 함께 단언.

대표 — `tests/modules/leave/requests-service.test.ts` 추가:
```ts
// (prisma mock: user.findUnique→{teamId}, getEffectiveScope mock 또는 rolePermission mock)
it("team-scope 승인자는 자기 팀 PENDING만 목록에 본다", async () => {
  // getEffectiveScope→"team", me.teamId="A", items=[{user:{teamId:"A"}},{user:{teamId:"B"}}]
  const q = await listApprovalQueue("approver");
  expect(q.map((i) => (i.user as { teamId: string }).teamId)).toEqual(["A"]);
});
it("무소속 team-scope 승인자는 목록 거부(F9)", async () => {
  // getEffectiveScope→"team", me.teamId=null
  await expect(listApprovalQueue("approver")).rejects.toBeInstanceOf(ForbiddenError);
});
```
(mock 전략: `listApprovalQueue`는 `getEffectiveScope`/`prisma`/`listAllRequestsWithUser`에 의존 — `@/kernel/access`와 `@/lib/prisma`를 vi.mock으로 제어.)

### 9. 통과 + 커밋
`npm test -- leave` 통과. `rg -n "\bdepartment\b" src/modules/leave src/app/api/leave src/app/api/admin/leave "src/app/(app)/leave"` → **0건**(범위 확인).

## Acceptance Criteria
- `npm run typecheck` → 0 errors.
- `npm test -- leave calendar-route history-page` → PASS (보안 negative 포함).
- `npm run lint` → 0 errors (leave→kernel/access 경계 허용).
- 범위 내 `department` 참조 0(전역 게이트 task-07).
- 수동: team-scope `leave.approval` 부여 사용자(매트릭스로) → 자기 팀 승인 큐만, 타 팀 승인 403.
- **F-D 원자성**: `approveTx`/`rejectRequest`의 in-tx **actor+applicant** `FOR UPDATE` 재점검 테스트 GREEN(actor 또는 applicant 재배정 시뮬레이션 시 ForbiddenError + 상태/메일 미실행).
- **F-G 직접입력 게이트**: team-scope 승인자 → 직접입력 버튼 미노출(canApprove/canManage=false) + 라우트 403(all-scope 유지).

## Cautions
- **Don't** approvals route에서 `requirePermission(leave.approval,view)`(all-scope)를 유지. Reason: team-scope 승인자가 막힌다(메뉴는 보이는데 목록 403, F5 역). 목록은 `getEffectiveScope` 경유.
- **Don't** approve/reject 라우트에 requirePermission(all-scope)를 남긴다. Reason: target-aware 가드가 서비스로 이동했고, all-scope 가드가 남으면 team-scope 승인자가 자기 팀도 못 한다. 라우트 가드 제거, 서비스가 SSOT.
- **Don't** team-scope 승인의 target 점검을 트랜잭션 **밖**에서만 하거나 precomputed `actorTeamId`를 권위로 쓴다. Reason: 팀 소속이 가변(admin 재배정)이라 점검과 상태 CAS 사이 **actor·applicant 둘 다** 재배정될 수 있다(F-D TOCTOU — actor가 A→B로 옮겨도 stale "A"로 구팀 승인 가능). 사전 `requirePermissionForTarget`은 빠른 403일 뿐, **권위 점검은 tx 내부에서 actor·applicant 두 행을 `FOR UPDATE` 잠그고 현재 teamId를 비교**하는 것이 SSOT.
- **Don't** `getLeaveAdminRecipients`를 인자 없이 호출하는 곳을 남긴다. Reason: 시그니처 변경(applicantTeamId 필수) — requests.ts enqueue·mail.ts drain 둘 다 갱신. 누락 시 typecheck 실패.
- **Don't** 무소속 team-scope actor를 `teamId=null`로 필터링. Reason: null 팀 버킷 전체 노출(F9). null이면 거부.
- **Don't** 직접입력(`POST /api/admin/leave/requests`·`/api/admin/leave/users`) 라우트를 team-scope로 열거나 그 UI를 summary 키로 게이트한다. Reason: 직접입력=임의 사용자 create+자동승인(본 증분 OUT). 라우트는 all-scope 유지, UI는 effective-scope-all로 게이트해야 team-scope 승인자에게 버튼이 보였다 403나는 불일치가 없다(F-G).
