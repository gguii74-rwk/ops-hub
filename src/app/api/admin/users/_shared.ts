import { NextResponse } from "next/server";
import { ForbiddenError, type PermissionSummary } from "@/kernel/access";
import type { SessionUser } from "@/lib/auth/types";
import type { ActorContext } from "@/modules/admin/users/services/guards";
import {
  EscalationError, MinAvailabilityError, RateLimitError, TokenError,
  UserConflictError, UserValidationError,
} from "@/modules/admin/users/errors";

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
