import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  assertNotSelfMutation, assertCanAssignRoles, assertCanSetSystemRole, assertOverrideWithinActorGrant,
  type ActorContext,
} from "./guards";
import { isPrivilegedRoleKey, PRIVILEGED_SYSTEM_ROLES } from "../policy";
import { EscalationError, UserConflictError } from "../errors";
import {
  getUserDetail, listUsers,
  approveTx, rejectTx, createActiveUserByAdminTx, updateUserTx, setRoles,
  createOverride, deleteOverride, setStatusTx, reactivateRejectedTx, resetPasswordTx,
  type UserListFilter, type UserDetail, type OverrideInput,
} from "../repositories";
import { prisma } from "@/lib/prisma";
import type { UserMailJob } from "../repositories/mail";
import { triggerLeaveMailDrain } from "@/modules/leave/services/mail";
import type {
  AdminCreateInput, ApproveInput, UpdateUserInput, OverrideInputDto,
} from "../validations";

const BCRYPT_ROUNDS = 10;

// 임시 비밀번호 생성(reset/admin-add). 정책(12자+) 충족하는 URL-safe 난수. base64url 16바이트 → 22자.
function generateTempPassword(): string {
  return randomBytes(16).toString("base64url");
}

// HTML 본문에 들어가는 모든 동적 텍스트는 이걸로 이스케이프 — 저장형 HTML 인젝션/피싱 차단(finding J, leave mail-templates의 esc와 동형).
// name(자가신청 입력)·reason(관리자 자유 입력)은 임의 HTML/링크를 담을 수 있어 수신자 메일함에 stored XSS-유사 위험이 된다.
const HTML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESC[c]);
}

// 사용자 도메인 메일 본문 — 공통 MailDelivery로 enqueue할 {recipients,subject,bodyHtml}(S8).
// leave는 전용 mail-templates가 있으나 사용자 메일은 본 증분에서 본문이 단순(승인/거절 통지)하므로 서비스에서 직접 구성한다.
// 동적 필드(name·reason)는 반드시 escapeHtml로 보간한다(finding J).
function buildApprovedMail(email: string, name: string): UserMailJob {
  return {
    recipients: [email],
    subject: "[ops-hub] 계정 가입이 승인되었습니다",
    bodyHtml: `<p>${escapeHtml(name)}님, ops-hub 계정 가입이 승인되었습니다. 이제 로그인하실 수 있습니다.</p>`,
  };
}
function buildRejectedMail(email: string, name: string, reason: string): UserMailJob {
  return {
    recipients: [email],
    subject: "[ops-hub] 계정 가입이 거절되었습니다",
    bodyHtml: `<p>${escapeHtml(name)}님, ops-hub 계정 가입 신청이 거절되었습니다.</p><p>사유: ${escapeHtml(reason)}</p>`,
  };
}

// 대상이 "특권"인지 — systemRole이 OWNER/ADMIN이거나 pm/admin 역할 보유(D14 reset-password 게이트).
function isPrivilegedTarget(target: { systemRole: string; roleKeys: string[] }): boolean {
  if ((PRIVILEGED_SYSTEM_ROLES as readonly string[]).includes(target.systemRole)) return true;
  return target.roleKeys.some(isPrivilegedRoleKey);
}

// 대상 조회 공통 — 없으면 충돌(라우트가 404/409 매핑). detail은 mutation 전 가드·메일·CAS 기준(updatedAt)에 쓴다.
async function loadTarget(id: string): Promise<UserDetail> {
  const target = await getUserDetail(id);
  if (!target) throw new UserConflictError("사용자를 찾을 수 없습니다.");
  return target;
}

// ── 조회(권한키는 라우트가 게이트. 서비스는 단순 위임). ──
export function listUsersForView(_actor: ActorContext, filter: UserListFilter) {
  return listUsers(filter);
}
export function getUserForEdit(_actor: ActorContext, id: string): Promise<UserDetail | null> {
  return getUserDetail(id);
}

// ── 승인(D11·D13ⓐⓑ·D12): 자가 금지 + 특권 역할/ systemRole 부여 가드 → approveTx(메일·CAS) → 트리거. ──
// 가드는 현재↔원하는 상태를 비교(finding C). 대상은 PENDING이라 현재 systemRole/roleKeys가 기준선이며,
// 승인으로 특권 systemRole·역할을 "추가"하는 것이 비-OWNER에게 차단된다(target.systemRole/roleKeys = 현재 상태).
// NF2: setRoles finding-H 패턴과 동형으로 recheck 클로저를 approveTx에 주입한다.
// UserAccessRole 쓰기는 User.updatedAt을 올리지 않아 CAS 단독으로 잡히지 않는 동시 역할부여 race를 트랜잭션 내 fresh reload로 닫는다.
// expectedUpdatedAt: 클라이언트가 본 행 버전(stale-tab lost-update 차단). 서버 재로드값(target.updatedAt)이 아니라
// 클라 값을 CAS에 써야 모달을 열어둔 사이의 silent 덮어쓰기를 막는다(다른 세션이 바꾼 행이면 409).
export async function approveUser(actor: ActorContext, id: string, input: ApproveInput, expectedUpdatedAt: Date): Promise<void> {
  const target = await loadTarget(id);
  assertNotSelfMutation(actor, id);
  assertCanSetSystemRole(actor, target.systemRole, input.systemRole);
  assertCanAssignRoles(actor, target.roleKeys, input.roleKeys); // 사전 검사(빠른 거부; stale 스냅샷)
  const mail = buildApprovedMail(target.email, target.name);
  await approveTx(id, actor.userId, {
    employmentType: input.employmentType, jobFunction: input.jobFunction,
    systemRole: input.systemRole, roleKeys: input.roleKeys,
    // NF2: name·teamId는 선택 — undefined면 사용자 자가입력 유지, 제공되면 admin 확정값이 권위.
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.teamId !== undefined ? { teamId: input.teamId ?? null } : {}),
  }, mail, expectedUpdatedAt,
    (currentRoleKeys) => assertCanAssignRoles(actor, currentRoleKeys, input.roleKeys), // 락 안 권위 재검사(fresh)
  );
  triggerLeaveMailDrain();
}

// ── 거절(D11·D13ⓐ): 자가 금지 → rejectTx(메일·CAS) → 트리거. ──
export async function rejectUser(actor: ActorContext, id: string, reason: string): Promise<void> {
  const target = await loadTarget(id);
  assertNotSelfMutation(actor, id);
  const mail = buildRejectedMail(target.email, target.name, reason);
  await rejectTx(id, actor.userId, reason, mail, target.updatedAt);
  triggerLeaveMailDrain();
}

// ── 직접추가(D4·D12·D13ⓑ): 특권 역할/systemRole 부여 가드 → 임시비번 해시 → createActiveUserByAdminTx. ──
// 신규 생성이라 "현재 상태"는 없다(비특권 기준선): 현재 systemRole="MEMBER", 현재 roleKeys=[]를 넘겨,
// 입력으로 특권 systemRole/역할을 "추가"하는 것만 비-OWNER에게 차단되게 한다(강등·제거 분기는 생성에 무의미).
export async function createUserByAdmin(actor: ActorContext, input: AdminCreateInput): Promise<{ id: string }> {
  assertCanSetSystemRole(actor, "MEMBER", input.systemRole);
  assertCanAssignRoles(actor, [], input.roleKeys);
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  // email은 사용자 병합 키(canonical). 공개 signup/resend와 동일하게 소문자로 저장해 대소문자만 다른 중복 신원 분리를 막는다.
  return createActiveUserByAdminTx({
    email: input.email.toLowerCase(), name: input.name, passwordHash,
    employmentType: input.employmentType, jobFunction: input.jobFunction, teamId: input.teamId ?? null,
    systemRole: input.systemRole, roleKeys: input.roleKeys, actorId: actor.userId,
  });
}

// ── 편집(D13ⓐ·D12): 자가 금지 + systemRole 변경 가드 → updateUserTx(CAS). ──
// 가드는 현재↔원하는 systemRole을 비교(finding C). target.systemRole(현재)을 넘겨 기존 OWNER/ADMIN을
// 강등하는 것도 비-OWNER에게 차단한다. patch.systemRole이 없으면 null(변경 의도 없음)이지만 현재가 특권이면 거부.
export async function updateUser(actor: ActorContext, id: string, patch: UpdateUserInput, expectedUpdatedAt: Date): Promise<void> {
  const target = await loadTarget(id);
  assertNotSelfMutation(actor, id);
  assertCanSetSystemRole(actor, target.systemRole, patch.systemRole ?? null);
  // CAS는 클라가 본 버전(expectedUpdatedAt)으로 — target.updatedAt(서버 재로드)이 아니다(stale-tab 차단).
  await updateUserTx(id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.teamId !== undefined ? { teamId: patch.teamId ?? null } : {}),
    ...(patch.employmentType !== undefined ? { employmentType: patch.employmentType } : {}),
    ...(patch.jobFunction !== undefined ? { jobFunction: patch.jobFunction } : {}),
    ...(patch.systemRole !== undefined ? { systemRole: patch.systemRole } : {}),
  }, actor.userId, expectedUpdatedAt);
}

// ── 역할 부여(D13ⓐ ⓑ): 자가 금지 + 특권 역할 가드 → setRoles(가용성은 repo가 보장). ──
// 가드는 현재↔원하는 역할 집합을 비교(finding C). mutation 전에 대상의 현재 roleKeys를 로드해
// 넘긴다 — 그래야 위임 admin이 목록에서 pm/admin을 빼서 제거(추가가 아닌)하는 lockout도 차단된다.
// finding H: stale 스냅샷(target.roleKeys)으로는 사전 거부만 하고, **권위 검사는 setRoles 락 안 fresh 역할로 재실행**한다
// (동시 OWNER action이 부여한 특권을 stale로 못 보고 빼버리는 lockout/race 차단). recheck 클로저가 actor를 캡처해 락 안에서 호출된다.
// expectedUpdatedAt: 클라가 본 User 행 버전. setRoles가 CAS+updatedAt bump으로 stale-tab 동시 역할변경을 막는다
// (자식 테이블 UserAccessRole 쓰기는 User.updatedAt을 안 올리므로 setRoles가 User 행을 touch해 버전을 전진시킨다).
export async function assignRoles(actor: ActorContext, id: string, roleKeys: string[], expectedUpdatedAt: Date): Promise<void> {
  const target = await loadTarget(id);
  assertNotSelfMutation(actor, id);
  assertCanAssignRoles(actor, target.roleKeys, roleKeys); // 사전 검사(빠른 거부; stale 스냅샷)
  await setRoles(id, roleKeys, actor.userId, expectedUpdatedAt, (currentRoleKeys) =>
    assertCanAssignRoles(actor, currentRoleKeys, roleKeys), // 락 안 권위 재검사(fresh)
  );
}

// ── override 생성(D13ⓐ ⓒ ⓓ): 자가 금지 + ALLOW 보유한도/scope/critical DENY 가드 → createOverride. ──
// F-Q: actor lock(FOR UPDATE)을 먼저 잡아 assertOverrideWithinActorGrant(getEffectiveScope)와 createOverride를 같은 tx에서.
export async function upsertOverride(actor: ActorContext, id: string, dto: OverrideInputDto): Promise<{ id: string }> {
  await loadTarget(id);
  assertNotSelfMutation(actor, id);
  const input: OverrideInput = {
    resource: dto.resource, action: dto.action, effect: dto.effect, scope: dto.scope,
    reason: dto.reason ?? null,
    startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
    endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
  };
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "kernel"."User" WHERE "id" = ${actor.userId} FOR UPDATE`;
    await assertOverrideWithinActorGrant(actor, dto.resource, dto.action, dto.effect, dto.scope, tx);
    return createOverride(id, input, actor.userId, tx);
  });
}

// ── override 삭제(D13ⓐ ⓒ ⓓ): 자가 금지 + 생성과 동일한 grant 경계 → deleteOverride(가용성은 repo가 보장). ──
// finding 2: 삭제도 grant 경계를 검사한다. 삭제는 effect를 뒤집는 효과(DENY 삭제=접근 복원=grant, ALLOW 삭제=회수)이므로
// **반전 effect**로 assertOverrideWithinActorGrant를 호출한다. critical(admin.*)은 effect 무관 OWNER-only라, 위임 admin이
// critical DENY를 삭제해 대상의 admin 권한을 OWNER 승인 없이 복원하는 것을 차단한다. override는 update 경로가 없어
// (생성·삭제만) key/effect가 불변이므로 로드 스냅샷으로 가드해도 stale race가 없다.
// F-Q: actor lock(FOR UPDATE)을 먼저 잡아 assertOverrideWithinActorGrant(getEffectiveScope)와 deleteOverride를 같은 tx에서.
export async function removeOverride(actor: ActorContext, id: string, overrideId: string): Promise<void> {
  const target = await loadTarget(id);
  assertNotSelfMutation(actor, id);
  const ov = target.overrides.find((o) => o.id === overrideId);
  if (!ov) throw new UserConflictError("해당 권한 예외를 찾을 수 없습니다.");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "kernel"."User" WHERE "id" = ${actor.userId} FOR UPDATE`;
    await assertOverrideWithinActorGrant(actor, ov.resource, ov.action, ov.effect === "DENY" ? "ALLOW" : "DENY", ov.scope, tx);
    await deleteOverride(id, overrideId, actor.userId, tx);
  });
}

// ── status 토글(D13ⓐ ⓔ): 자가 금지 + 특권 대상 OWNER-only → REJECTED→ACTIVE는 reactivate, 그 외 ACTIVE/DISABLED는 setStatus. ──
// finding 1: resetPassword와 동형으로 특권 대상(OWNER/ADMIN systemRole·특권 역할)의 상태 변경은 OWNER만(위임 admin이
// 특권 사용자를 disable해 세션을 무효화·DoS하는 것 차단). 사전 검사(stale) + 락 안 fresh recheck로 race까지 닫는다.
export async function setUserStatus(actor: ActorContext, id: string, status: "ACTIVE" | "DISABLED", expectedUpdatedAt: Date): Promise<void> {
  const target = await loadTarget(id);
  assertNotSelfMutation(actor, id);
  if (!actor.isOwner && isPrivilegedTarget(target)) {
    throw new EscalationError("특권 사용자의 상태 변경은 OWNER만 가능합니다.");
  }
  const recheck = (fresh: { systemRole: string; roleKeys: string[] }) => {
    if (!actor.isOwner && isPrivilegedTarget(fresh)) {
      throw new EscalationError("특권 사용자의 상태 변경은 OWNER만 가능합니다.");
    }
  };
  // F2: PENDING/INVITED 사용자는 status toggle 대상이 아님 — approveTx/rejectTx 경로로만 처리 가능.
  if (target.status === "PENDING" || target.status === "INVITED") {
    throw new UserConflictError("승인 대기 중인 사용자는 승인/거절로 처리하세요.");
  }
  const now = new Date();
  // CAS는 클라가 본 버전(expectedUpdatedAt)으로 — stale-tab lost-update 차단.
  if (status === "ACTIVE" && target.status === "REJECTED") {
    if (!actor.isOwner && !actor.permissionKeys.has("admin.users:approve")) {
      throw new EscalationError("거절된 계정의 재활성은 승인(admin.users:approve) 권한이 필요합니다.");
    }
    await reactivateRejectedTx(id, actor.userId, now, expectedUpdatedAt, recheck);
    return;
  }
  await setStatusTx(id, status, actor.userId, now, expectedUpdatedAt, recheck);
}

// ── 비번 재설정(D14): 자가 금지 + 특권 대상은 OWNER-only → 임시비번 해시 → resetPasswordTx. 임시비번은 반환(관리자 전달용). ──
// finding H: 특권 대상 판정은 stale 스냅샷으로 사전 거부만 하고, **권위 검사는 resetPasswordTx 락 안 fresh state로 재실행**한다
// (대상이 특권이 된 직후 위임 admin이 reset해 임시비번을 탈취하는 race 차단). recheck 클로저가 actor를 캡처해 락 안에서 호출된다.
export async function resetPassword(actor: ActorContext, id: string): Promise<{ temporaryPassword: string }> {
  // Finding E: admin reset-password는 '타인' 비번 재설정 전용. 본인(OWNER 포함) self-reset은 마지막 OWNER
  // 락아웃 위험(임시비번 응답 유실 시 복구 불가)이 있어 무조건 차단 — 본인 비번은 change-password 흐름을 쓴다.
  // (assertNotSelfMutation은 OWNER를 면제하므로 reset 경로엔 부족하다.)
  if (actor.userId === id) {
    throw new EscalationError("자신의 비밀번호는 비밀번호 변경 기능을 사용하세요.");
  }
  const target = await loadTarget(id);
  assertNotSelfMutation(actor, id);
  // 특권 대상(OWNER/ADMIN systemRole 또는 특권 역할)은 OWNER만 재설정 가능(위임 admin 거부). 사전 검사(빠른 거부; stale 스냅샷).
  if (!actor.isOwner && isPrivilegedTarget(target)) {
    throw new EscalationError("특권 사용자의 비밀번호 재설정은 OWNER만 가능합니다.");
  }
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
  await resetPasswordTx(id, passwordHash, actor.userId, new Date(), (fresh) => {
    // 락 안 fresh systemRole·roleKeys로 권위 재검사.
    if (!actor.isOwner && isPrivilegedTarget(fresh)) {
      throw new EscalationError("특권 사용자의 비밀번호 재설정은 OWNER만 가능합니다.");
    }
  });
  // 응답 필드명은 `temporaryPassword`로 통일(finding 3) — 라우트(task-05)·UI(task-08)가 같은 키로 1회 노출/표시.
  return { temporaryPassword: tempPassword };
}
