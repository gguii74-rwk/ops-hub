import "server-only";
import { Prisma, type UserStatus } from "@prisma/client";
import { prisma, type PrismaTx } from "@/lib/prisma";
import { UserConflictError, RateLimitError } from "../errors";
import { withAvailabilityLock, assertMinAvailability } from "../services/guards";
import { writeAudit } from "@/kernel/audit";
import { enqueueUserMail, type UserMailJob } from "./mail";

// ── 타입 ──
export interface UserListFilter { status?: UserStatus; employmentType?: string; jobFunction?: string; q?: string; page: number; pageSize: number; }
export interface UserRow {
  id: string; email: string; name: string; status: UserStatus;
  employmentType: string; jobFunction: string; systemRole: string; department: string | null;
  roleKeys: string[]; createdAt: Date;
}
export interface OverrideRow { id: string; resource: string; action: string; effect: string; scope: string; reason: string | null; startsAt: Date | null; endsAt: Date | null; }
export interface UserDetail extends UserRow { mustChangePassword: boolean; emailVerifiedAt: Date | null; updatedAt: Date; overrides: OverrideRow[]; }
export interface OverrideInput { resource: string; action: string; effect: "ALLOW" | "DENY"; scope: string; reason: string | null; startsAt: Date | null; endsAt: Date | null; }

// roleKeys → AccessRole.id 매핑. 모든 키가 존재해야 함(없으면 충돌). tx/전역 어느 클라이언트로도 호출 가능.
async function resolveRoleIds(client: PrismaTx, roleKeys: string[]): Promise<string[]> {
  if (roleKeys.length === 0) return [];
  const roles = await client.accessRole.findMany({ where: { key: { in: roleKeys } }, select: { id: true, key: true } });
  if (roles.length !== new Set(roleKeys).size) throw new UserConflictError("알 수 없는 역할이 포함되어 있습니다.");
  return roles.map((r) => r.id);
}

// 역할 집합 확정(idempotent): createMany(skipDuplicates) + 목표에 없는 기존 배정 deleteMany(차집합). 트랜잭션 내 호출.
async function applyRoles(tx: PrismaTx, userId: string, roleKeys: string[]): Promise<void> {
  const roleIds = await resolveRoleIds(tx, roleKeys);
  await tx.userAccessRole.createMany({
    data: roleIds.map((roleId) => ({ userId, roleId })),
    skipDuplicates: true,
  });
  const existing = await tx.userAccessRole.findMany({ where: { userId }, select: { roleId: true } });
  const stale = existing.map((e) => e.roleId).filter((id) => !roleIds.includes(id));
  if (stale.length > 0) await tx.userAccessRole.deleteMany({ where: { userId, roleId: { in: stale } } });
}

// ── 조회 ──
export async function listUsers(f: UserListFilter): Promise<{ rows: UserRow[]; total: number; pendingCount: number }> {
  const where: Prisma.UserWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.employmentType ? { employmentType: f.employmentType as Prisma.UserWhereInput["employmentType"] } : {}),
    ...(f.jobFunction ? { jobFunction: f.jobFunction as Prisma.UserWhereInput["jobFunction"] } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { email: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, pendingCount] = await Promise.all([
    prisma.user.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize,
      select: {
        id: true, email: true, name: true, status: true, employmentType: true, jobFunction: true,
        systemRole: true, department: true, createdAt: true,
        roleAssignments: { select: { role: { select: { key: true } } } },
      },
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: { status: "PENDING" } }),
  ]);
  return {
    rows: rows.map((u) => ({
      id: u.id, email: u.email, name: u.name, status: u.status,
      employmentType: u.employmentType, jobFunction: u.jobFunction, systemRole: u.systemRole,
      department: u.department, createdAt: u.createdAt, roleKeys: u.roleAssignments.map((ra) => ra.role.key),
    })),
    total, pendingCount,
  };
}

export async function getUserDetail(id: string): Promise<UserDetail | null> {
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, status: true, employmentType: true, jobFunction: true,
      systemRole: true, department: true, createdAt: true, updatedAt: true,
      mustChangePassword: true, emailVerifiedAt: true,
      roleAssignments: { select: { role: { select: { key: true } } } },
      permissionOverrides: {
        select: { id: true, effect: true, scope: true, reason: true, startsAt: true, endsAt: true,
          permission: { select: { resource: true, action: true } } },
      },
    },
  });
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, status: u.status,
    employmentType: u.employmentType, jobFunction: u.jobFunction, systemRole: u.systemRole,
    department: u.department, createdAt: u.createdAt, updatedAt: u.updatedAt,
    mustChangePassword: u.mustChangePassword, emailVerifiedAt: u.emailVerifiedAt,
    roleKeys: u.roleAssignments.map((ra) => ra.role.key),
    overrides: u.permissionOverrides.map((o) => ({
      id: o.id, resource: o.permission.resource, action: o.permission.action,
      effect: o.effect, scope: o.scope, reason: o.reason, startsAt: o.startsAt, endsAt: o.endsAt,
    })),
  };
}

// ── 자가가입(C안) ──
// 비번 없이 PENDING 생성. 충돌 시: (a) 만료된 미검증 PENDING이면 같은 행을 교체(D10·D16) (b) 그 외(활성·검증완료·REJECTED·미만료 PENDING)는 거부.
// finding #4: PENDING User + 검증메일 MailDelivery를 **같은 트랜잭션**에서 생성한다(부분실패로 메일 없는 PENDING 방지).
//            교체 경로도 토큰·메일을 재발급/재enqueue해 멱등 재시도가 동작하게 한다.
// finding #3/B: PENDING 상한 검사를 같은 트랜잭션 안에서 tx.user.count로 수행한다(standalone count 후 별도 생성 금지 —
//            동시 요청이 모두 capacity를 관측해 전역 cap을 초과하는 것 방지). 라우트는 별도 enquedue 트랜잭션을 두지 않는다.
//            **cap 검사+생성/교체를 race-safe하게**: 트랜잭션 시작에서 cap 전용 advisory lock(`pg_advisory_xact_lock(hashtext('signup-cap'))`)을
//            획득해 동시 signup을 직렬화한다 — read-committed에서 count→write 사이에 다른 signup이 끼어들어 모두 cap 미만을 관측하고
//            모두 insert하는 race(bounded-creation 불변식 초과)를 막는다. 이 키는 가용성용 `withAvailabilityLock`의 키(고정 상수
//            `4815162342`, S5)와 **별개**다(서로 다른 불변식을 직렬화하므로 키를 공유하면 안 됨). 락은 트랜잭션 종료(커밋/롤백) 시 자동 해제.
//            cap count는 **만료된 미검증 PENDING(`emailVerifyExpiresAt < now`)을 제외**한다(`emailVerifyExpiresAt > now`만 카운트) —
//            stale 만료 행이 별도 cleanup 전까지 cap을 영구 점유하는 것을 막는다(어차피 D10·D16상 교체 허용 대상).
// deps 역전 방지: 상한 값은 `PENDING_UNVERIFIED_CAP` 상수를 import하지 않고 `pendingCap` 인자로 주입받는다.
//            상수는 task-06 rate-limit.ts가 소유하고, 라우트(task-06)가 호출 시 `pendingCap: PENDING_UNVERIFIED_CAP`로 넘긴다(정상 방향 06→03).
export async function createPendingSignup(args: {
  email: string; name: string; employmentType: string; jobFunction: string; department: string | null;
  tokenHash: string; tokenExpiresAt: Date; mail: UserMailJob; pendingCap: number;
}): Promise<{ id: string }> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    // cap 전용 advisory lock — cap 검사+생성/교체 구간을 직렬화(가용성용 lock과 별개 키). 트랜잭션 종료 시 자동 해제.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('signup-cap'))`;
    // 전역 미검증 PENDING 상한 — User 생성과 같은 트랜잭션 스냅샷에서 관측(cap 초과 동시생성 차단). 상한 값은 인자로 주입받음.
    // 만료된 미검증 PENDING(emailVerifyExpiresAt < now)은 제외 — stale 행이 cap을 영구 점유하지 않도록(교체 대상이므로).
    const pending = await tx.user.count({
      where: { status: "PENDING", emailVerifiedAt: null, emailVerifyExpiresAt: { gt: now } },
    });
    if (pending >= args.pendingCap) throw new RateLimitError("현재 신규 가입을 받을 수 없습니다. 잠시 후 다시 시도해 주세요.");

    const existing = await tx.user.findUnique({
      where: { email: args.email },
      select: { id: true, status: true, emailVerifiedAt: true, emailVerifyExpiresAt: true },
    });
    const data = {
      name: args.name,
      employmentType: args.employmentType as Prisma.UserCreateInput["employmentType"],
      jobFunction: args.jobFunction as Prisma.UserCreateInput["jobFunction"],
      department: args.department,
      status: "PENDING" as const, passwordHash: null, emailVerifiedAt: null,
      emailVerifyTokenHash: args.tokenHash, emailVerifyExpiresAt: args.tokenExpiresAt,
    };
    let id: string;
    if (existing) {
      const replaceable = existing.status === "PENDING" && existing.emailVerifiedAt === null
        && existing.emailVerifyExpiresAt !== null && existing.emailVerifyExpiresAt < now;
      if (!replaceable) throw new UserConflictError("이미 등록된 이메일입니다.");
      // NF1: id-only update → conditional updateMany. where에 replaceability 조건(status+emailVerifiedAt+만료)을 반복해
      // read와 write 사이에 동시 rejectTx가 REJECTED로 바꾼 경우를 count=0으로 감지 → UserConflictError.
      const replaced = await tx.user.updateMany({
        where: { id: existing.id, status: "PENDING", emailVerifiedAt: null, emailVerifyExpiresAt: { lt: now } },
        data,
      });
      if (replaced.count === 0) throw new UserConflictError("이미 등록된 이메일입니다.");
      id = existing.id;
    } else {
      const created = await tx.user.create({ data: { email: args.email, ...data } });
      id = created.id;
    }
    // 검증 메일을 같은 트랜잭션에서 enqueue — User 생성과 원자적(둘 다 커밋 or 둘 다 롤백).
    await enqueueUserMail(tx, { eventType: "VERIFY_EMAIL", ...args.mail });
    return { id };
  });
}

// set-password 토큰 소비: 만료 안 된 토큰 일치 행에 passwordHash+emailVerifiedAt 기록, 토큰 소거. PENDING 유지.
// F3: status:PENDING + emailVerifiedAt:null 조건 추가 — 이미 검증됐거나 REJECTED된 사용자의 구 토큰 소비 차단.
export async function setPasswordViaToken(tokenHash: string, passwordHash: string, now: Date): Promise<{ id: string } | null> {
  const { count } = await prisma.user.updateMany({
    where: { emailVerifyTokenHash: tokenHash, emailVerifyExpiresAt: { gt: now }, status: "PENDING", emailVerifiedAt: null },
    data: { passwordHash, emailVerifiedAt: now, emailVerifyTokenHash: null, emailVerifyExpiresAt: null },
  });
  if (count === 0) return null;
  const u = await prisma.user.findFirst({ where: { emailVerifiedAt: now }, select: { id: true } });
  return u ? { id: u.id } : null;
}

// 검증 메일 재발송: 미검증 PENDING의 토큰·만료 갱신 + 검증메일 재enqueue.
// finding #4: 토큰 갱신과 메일 재enqueue를 **같은 트랜잭션**에서 — 토큰만 갱신되고 메일이 빠지는 부분실패를 막는다(멱등 재발송).
export async function refreshVerifyToken(email: string, tokenHash: string, tokenExpiresAt: Date, mail: UserMailJob): Promise<{ id: string } | null> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { email, status: "PENDING", emailVerifiedAt: null },
      data: { emailVerifyTokenHash: tokenHash, emailVerifyExpiresAt: tokenExpiresAt },
    });
    if (count === 0) return null;
    const u = await tx.user.findFirst({ where: { email }, select: { id: true } });
    if (!u) return null;
    await enqueueUserMail(tx, { eventType: "VERIFY_EMAIL", ...mail });
    return { id: u.id };
  });
}

// ── 관리자 직접추가(D4) ──
export async function createActiveUserByAdminTx(args: {
  email: string; name: string; passwordHash: string; employmentType: string; jobFunction: string;
  department: string | null; systemRole: string; roleKeys: string[]; actorId: string;
}): Promise<{ id: string }> {
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: args.email, name: args.name, passwordHash: args.passwordHash,
          employmentType: args.employmentType as Prisma.UserCreateInput["employmentType"],
          jobFunction: args.jobFunction as Prisma.UserCreateInput["jobFunction"],
          department: args.department,
          systemRole: args.systemRole as Prisma.UserCreateInput["systemRole"],
          status: "ACTIVE", mustChangePassword: true, emailVerifiedAt: now,
        },
        select: { id: true },
      });
      await applyRoles(tx, created.id, args.roleKeys);
      await writeAudit(tx, { actorId: args.actorId, entityType: "User", entityId: created.id, action: "admin_create", metadata: { email: args.email, systemRole: args.systemRole, roleKeys: args.roleKeys } });
      return { id: created.id };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new UserConflictError("이미 등록된 이메일입니다.");
    throw e;
  }
}

// ── 승인/거절(D11 — status-CAS + 역할확정 + 감사 + 메일 enqueue) ──
// NF2: recheck?(currentRoleKeys) — CAS 후 applyRoles 전에 대상의 현재 역할을 fresh reload해 호출한다.
// UserAccessRole 쓰기는 User.updatedAt을 올리지 않아 CAS 만으로는 잡히지 않는 동시 역할부여 race를 닫는다.
// throw 시 트랜잭션 롤백 — applyRoles·mail 미실행. setRoles의 finding-H recheck 패턴과 동형.
export async function approveTx(
  id: string, actorId: string,
  decision: { employmentType: string; jobFunction: string; systemRole: string; roleKeys: string[]; name?: string; department?: string | null },
  mail: UserMailJob, expectedUpdatedAt: Date,
  recheck?: (currentRoleKeys: string[]) => void,
): Promise<void> {
  // NF3: setRoles/setStatusTx와 동일한 advisory lock 안에서 실행해 동시 역할부여 race를 직렬화한다.
  // 락 없이 $transaction만 쓰면 recheck와 applyRoles 사이에 setRoles가 특권 역할을 커밋할 수 있고,
  // applyRoles가 그 역할을 결정 목록에 없다는 이유로 삭제하는 erase race가 발생한다.
  await withAvailabilityLock(async (tx) => {
    const u = await tx.user.findUnique({ where: { id }, select: { status: true, emailVerifiedAt: true, updatedAt: true } });
    if (!u) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    if (u.status !== "PENDING") throw new UserConflictError("이미 처리된 신청입니다.");
    if (!u.emailVerifiedAt) throw new UserConflictError("이메일 검증(비밀번호 설정) 전에는 승인할 수 없습니다.");
    const updated = await tx.user.updateMany({
      where: { id, status: "PENDING", updatedAt: expectedUpdatedAt },
      data: {
        status: "ACTIVE",
        employmentType: decision.employmentType as Prisma.UserUpdateInput["employmentType"],
        jobFunction: decision.jobFunction as Prisma.UserUpdateInput["jobFunction"],
        systemRole: decision.systemRole as Prisma.UserUpdateInput["systemRole"],
        // NF2: admin 확정값이 권위 — 제공된 경우만 덮어씀(없으면 사용자 자가입력 유지).
        ...(decision.name !== undefined ? { name: decision.name } : {}),
        ...(decision.department !== undefined ? { department: decision.department } : {}),
      },
    });
    if (updated.count === 0) throw new UserConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
    if (recheck) {
      const cur = await tx.userAccessRole.findMany({ where: { userId: id }, select: { role: { select: { key: true } } } });
      recheck(cur.map((r) => r.role.key)); // EscalationError 시 applyRoles 전에 중단(트랜잭션 롤백)
    }
    await applyRoles(tx, id, decision.roleKeys);
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "approve", metadata: { systemRole: decision.systemRole, roleKeys: decision.roleKeys } });
    await enqueueUserMail(tx, { eventType: "APPROVED", ...mail });
  });
}

export async function rejectTx(id: string, actorId: string, reason: string, mail: UserMailJob, expectedUpdatedAt: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id }, select: { status: true, updatedAt: true } });
    if (!u) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    if (u.status !== "PENDING") throw new UserConflictError("이미 처리된 신청입니다.");
    const updated = await tx.user.updateMany({
      where: { id, status: "PENDING", updatedAt: expectedUpdatedAt },
      // F3: 거절 시 verify 토큰 소거 — 기 발급된 검증 링크를 무효화해 REJECTED 사용자의 토큰 소비 차단.
      data: { status: "REJECTED", emailVerifyTokenHash: null, emailVerifyExpiresAt: null },
    });
    if (updated.count === 0) throw new UserConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "reject", metadata: { reason } });
    await enqueueUserMail(tx, { eventType: "REJECTED", ...mail });
  });
}

// ── 편집(CAS + systemRole 강등 시 가용성) ──
export async function updateUserTx(
  id: string,
  patch: { name?: string; department?: string | null; employmentType?: string; jobFunction?: string; systemRole?: string },
  actorId: string, expectedUpdatedAt: Date,
): Promise<void> {
  // systemRole 변경은 가용성에 영향(OWNER/관리자 강등) → 락 + 커밋 전 재검사. 그 외 속성 patch는 가용성 무관.
  const affectsAvailability = patch.systemRole !== undefined;
  const run = async (tx: PrismaTx) => {
    const u = await tx.user.findUnique({ where: { id }, select: { status: true, updatedAt: true } });
    if (!u) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    const updated = await tx.user.updateMany({
      where: { id, updatedAt: expectedUpdatedAt },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.department !== undefined ? { department: patch.department } : {}),
        ...(patch.employmentType !== undefined ? { employmentType: patch.employmentType as Prisma.UserUpdateInput["employmentType"] } : {}),
        ...(patch.jobFunction !== undefined ? { jobFunction: patch.jobFunction as Prisma.UserUpdateInput["jobFunction"] } : {}),
        ...(patch.systemRole !== undefined ? { systemRole: patch.systemRole as Prisma.UserUpdateInput["systemRole"] } : {}),
      },
    });
    if (updated.count === 0) throw new UserConflictError("처리 중 정보가 변경되었습니다. 다시 확인해 주세요.");
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "update", metadata: { patch } });
    if (affectsAvailability) await assertMinAvailability(tx);
  };
  if (affectsAvailability) await withAvailabilityLock(run);
  else await prisma.$transaction(run);
}

// 역할 집합 확정(가용성 — role 제거가 마지막 관리자를 떨어뜨릴 수 있음).
// finding H: anti-escalation 가드는 stale 스냅샷이 아니라 **락 안 fresh currentRoleKeys**로 재검사한다
// (UserAccessRole 쓰기는 User.updatedAt을 올리지 않아 CAS로 못 잡으므로 락 안 재로드가 필수).
// recheck(서비스가 actor 캡처 클로저로 주입)를 fresh 역할로 호출 — 위반 시 throw로 applyRoles 전 롤백.
export async function setRoles(
  id: string, roleKeys: string[], actorId: string,
  recheck?: (currentRoleKeys: string[]) => void,
): Promise<void> {
  await withAvailabilityLock(async (tx) => {
    if (recheck) {
      const cur = await tx.userAccessRole.findMany({ where: { userId: id }, select: { role: { select: { key: true } } } });
      recheck(cur.map((r) => r.role.key)); // EscalationError 시 applyRoles 전에 중단(트랜잭션 롤백)
    }
    await applyRoles(tx, id, roleKeys);
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "set_roles", metadata: { roleKeys } });
    await assertMinAvailability(tx);
  });
}

// override 생성(가용성 — DENY가 마지막 관리자를 lockout할 수 있음).
export async function createOverride(id: string, o: OverrideInput, actorId: string): Promise<{ id: string }> {
  return withAvailabilityLock(async (tx) => {
    const perm = await tx.permission.findUnique({ where: { resource_action: { resource: o.resource, action: o.action } }, select: { id: true } });
    if (!perm) throw new UserConflictError("알 수 없는 권한입니다.");
    let created: { id: string };
    try {
      created = await tx.userPermissionOverride.create({
        data: { userId: id, permissionId: perm.id, effect: o.effect, scope: o.scope, reason: o.reason, startsAt: o.startsAt, endsAt: o.endsAt },
        select: { id: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new UserConflictError("이미 존재하는 권한 예외입니다.");
      throw e;
    }
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "create_override", metadata: { resource: o.resource, action: o.action, effect: o.effect, scope: o.scope } });
    await assertMinAvailability(tx);
    return { id: created.id };
  });
}

// override 삭제(가용성 — ALLOW 제거가 관리자 권한을 떨어뜨릴 수 있음). 본인 소유 행만.
export async function deleteOverride(id: string, overrideId: string, actorId: string): Promise<void> {
  await withAvailabilityLock(async (tx) => {
    const { count } = await tx.userPermissionOverride.deleteMany({ where: { id: overrideId, userId: id } });
    if (count === 0) throw new UserConflictError("해당 권한 예외를 찾을 수 없습니다.");
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "delete_override", metadata: { overrideId } });
    await assertMinAvailability(tx);
  });
}

// ── 상태 전이(세션 무효화 동반·가용성) ──
// disable은 sessionInvalidatedAt=now로 기존 세션 즉시 무효화(D14·상태전이). enable은 무효화하지 않는다.
// finding 1: 특권 대상 판정(D14 동형)을 stale 스냅샷이 아니라 **락 안 fresh systemRole·roleKeys**로 재검사한다
// (위임 admin이 특권이 된 직후 대상을 disable해 세션을 무효화하는 race 차단). recheck를 fresh state로 호출 — throw 시 변경 전 롤백.
export async function setStatusTx(
  id: string, status: "ACTIVE" | "DISABLED", actorId: string, now: Date,
  recheck?: (target: { systemRole: string; roleKeys: string[] }) => void,
): Promise<void> {
  await withAvailabilityLock(async (tx) => {
    const u = await tx.user.findUnique({
      where: { id },
      select: { status: true, updatedAt: true, systemRole: true, roleAssignments: { select: { role: { select: { key: true } } } } },
    });
    if (!u) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    if (recheck) recheck({ systemRole: u.systemRole, roleKeys: u.roleAssignments.map((r) => r.role.key) }); // finding 1 — 변경 전 중단
    // F2: status toggle은 ACTIVE↔DISABLED 전이만 허용. PENDING/INVITED/REJECTED는 전용 플로우(approve/reject/reactivate)로 처리.
    if (u.status !== "ACTIVE" && u.status !== "DISABLED") throw new UserConflictError("승인 대기 중인 사용자는 승인/거절로 처리하세요.");
    if (u.status === status) throw new UserConflictError("이미 해당 상태입니다.");
    const updated = await tx.user.updateMany({
      where: { id, status: u.status, updatedAt: u.updatedAt },
      data: { status, ...(status === "DISABLED" ? { sessionInvalidatedAt: now } : {}) },
    });
    if (updated.count === 0) throw new UserConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: status === "DISABLED" ? "disable" : "enable", metadata: {} });
    await assertMinAvailability(tx);
  });
}

// REJECTED→ACTIVE 재활성(관리자만). 세션 무효화 불필요(REJECTED는 로그인 불가였음).
export async function reactivateRejectedTx(
  id: string, actorId: string, now: Date,
  recheck?: (target: { systemRole: string; roleKeys: string[] }) => void,
): Promise<void> {
  await withAvailabilityLock(async (tx) => {
    const u = await tx.user.findUnique({
      where: { id },
      select: { status: true, updatedAt: true, systemRole: true, emailVerifiedAt: true, roleAssignments: { select: { role: { select: { key: true } } } } },
    });
    if (!u) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    if (recheck) recheck({ systemRole: u.systemRole, roleKeys: u.roleAssignments.map((r) => r.role.key) }); // finding 1
    if (u.status !== "REJECTED") throw new UserConflictError("거절 상태의 사용자만 재활성할 수 있습니다.");
    // Finding C: 미검증(비번 미설정)으로 거절된 계정을 ACTIVE로 만들면 로그인 불가·검증 토큰 없음 wedged 계정이 된다.
    // approveTx와 동일 활성화 불변식 강제 — 검증된 계정만 재활성 허용.
    if (!u.emailVerifiedAt) throw new UserConflictError("이메일 검증(비밀번호 설정) 전 계정은 재활성할 수 없습니다.");
    const updated = await tx.user.updateMany({
      where: { id, status: "REJECTED" },
      data: { status: "ACTIVE" },
    });
    if (updated.count === 0) throw new UserConflictError("처리 중 상태가 변경되었습니다. 다시 확인해 주세요.");
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "reactivate", metadata: { now } });
    await assertMinAvailability(tx);
  });
}

// ── 비밀번호(D14 reset / D15 change) ──
// reset(관리자): 임시비번 → mustChangePassword=true + sessionInvalidatedAt=now(기존 세션 무효화). 가용성 — 마지막 관리자를 must-change로 만들면 거부.
// finding H: 특권 대상 판정(D14)을 stale 스냅샷이 아니라 **락 안 fresh systemRole·roleKeys**로 재검사한다
// (대상이 특권이 된 직후 위임 admin이 reset해 임시비번을 탈취하는 race 차단). recheck를 fresh state로 호출 — 위반 시 throw로 reset 전 롤백.
export async function resetPasswordTx(
  id: string, passwordHash: string, actorId: string, now: Date,
  recheck?: (target: { systemRole: string; roleKeys: string[] }) => void,
): Promise<void> {
  await withAvailabilityLock(async (tx) => {
    const u = await tx.user.findUnique({
      where: { id },
      select: { systemRole: true, roleAssignments: { select: { role: { select: { key: true } } } } },
    });
    if (!u) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    if (recheck) recheck({ systemRole: u.systemRole, roleKeys: u.roleAssignments.map((r) => r.role.key) }); // EscalationError 시 reset 전 중단(롤백)
    const { count } = await tx.user.updateMany({
      where: { id },
      data: { passwordHash, mustChangePassword: true, sessionInvalidatedAt: now },
    });
    if (count === 0) throw new UserConflictError("사용자를 찾을 수 없습니다.");
    await writeAudit(tx, { actorId, entityType: "User", entityId: id, action: "reset_password", metadata: {} });
    await assertMinAvailability(tx);
  });
}

// change(자가/강제변경): passwordHash + passwordChangedAt=now(타 세션 무효화 기준) + mustChangePassword 해제. 가용성 무관(스스로 사용 가능 상태로 복귀).
// finding 4: expectedCurrentHash CAS — 라우트가 현재비번 검증에 쓴 해시를 where에 넣는다. 검증~쓰기 사이에 admin reset(또는 타 변경)이
// passwordHash를 바꾸면 count 0 → UserConflictError(이전 비번 사용자가 reset/must-change 복구를 덮어쓰는 race 차단). 라우트는 409로 재로그인 유도.
// F-RACE: where에 status="ACTIVE"도 포함해 **현재 계정 상태에 fail-closed**. 검증~쓰기 사이 admin disable(status=DISABLED·
// sessionInvalidatedAt만 변경, passwordHash 불변)이 끼면 hash CAS는 통과하므로, status 가드가 없으면 비활성 계정에 비번이 박히고
// mustChangePassword가 해제돼 추후 재활성화 시 사용자 지정 비번이 잔존한다. status 조건으로 count 0 → UserConflictError(409).
export async function changePasswordTx(id: string, passwordHash: string, now: Date, expectedCurrentHash: string): Promise<void> {
  const { count } = await prisma.user.updateMany({
    where: { id, passwordHash: expectedCurrentHash, status: "ACTIVE" },
    data: { passwordHash, passwordChangedAt: now, mustChangePassword: false },
  });
  if (count === 0) throw new UserConflictError("처리 중 비밀번호가 변경되었습니다. 다시 로그인해 주세요.");
}
