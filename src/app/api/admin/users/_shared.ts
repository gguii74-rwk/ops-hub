import { NextResponse } from "next/server";
import { ForbiddenError, getPermissionSummary, type PermissionSummary } from "@/kernel/access";
import type { SessionUser } from "@/lib/auth/types";
import type { ActorContext } from "@/modules/admin/users/services/guards";
import {
  EscalationError, MinAvailabilityError, RateLimitError, TokenError,
  UserConflictError, UserValidationError,
} from "@/modules/admin/users/errors";

// 단일 권위 권한 스냅샷: getPermissionSummary 한 번으로 게이트와 ActorContext를 모두 만든다(Finding A).
// 두 read(requirePermission+getPermissionSummary)의 divergence(회수 race)를 없앤다. 키 부재면 ForbiddenError(→403).
export async function authorize(userId: string, resource: string, action: string): Promise<PermissionSummary> {
  const summary = await getPermissionSummary(userId);
  // OWNER 허용은 접근제어 SSOT의 최상위 규칙(hasPermission line: `if (ctx.isOwner) return true`와 동일). OWNER의 keys는
  // Permission 테이블 전체에서 파생되므로, 코드가 참조하는 권한키가 아직 Permission 행으로 없으면(예: 신규 키가 seed에만 있고
  // migration 미적용) OWNER조차 403이 되어 복구가 막힌다. OWNER는 키 멤버십과 무관하게 통과시켜 seed 의존 lockout을 없앤다.
  // (must-change OWNER는 getPermissionSummary가 isOwner=false로 fail-closed하므로 여기서도 차단된다.)
  if (summary.isOwner) return summary;
  if (!summary.keys.includes(`${resource}:${action}`)) {
    throw new ForbiddenError(`${resource}:${action} 권한이 없습니다.`);
  }
  return summary;
}

// S4 도메인 에러 → HTTP 매핑. 알 수 없는 에러는 재throw해 500을 삼키지 않는다(leave _shared.ts와 동형).
export function mapError(error: unknown): NextResponse {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof EscalationError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof UserConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof MinAvailabilityError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof UserValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof TokenError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
  throw error;
}

// S5 ActorContext 빌더. **isOwner·permissionKeys 모두 getPermissionSummary의 단일 권위 DB read에서** 가져온다(finding 3).
// isOwner를 `u.systemRole`(session.user — 별도 read·stale 가능)에서 뽑지 않는다: actor 권위와 권한 결정을 같은 read에
// 묶어 auth()~권한검사 사이 OWNER 강등 TOCTOU를 없앤다. getPermissionSummary는 must-change/비활성이면 isOwner=false로
// fail-closed(task-07). userId만 세션에서 취한다(id는 불변·비특권 식별자).
export function buildActorCtx(u: SessionUser, summary: PermissionSummary): ActorContext {
  return { userId: u.id, isOwner: summary.isOwner, permissionKeys: new Set(summary.keys) };
}
