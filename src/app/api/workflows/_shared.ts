import { NextResponse } from "next/server";
import { ForbiddenError } from "@/kernel/access";
import type { PermissionSummary } from "@/kernel/access";
import { ConflictError, NotImplementedError } from "@/modules/workflows/types";
import type { SessionUser } from "@/lib/auth/types";

// 알려진 도메인 에러만 상태로 매핑. 그 외는 rethrow(Next가 500).
export function mapError(error: unknown): NextResponse {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof ConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof NotImplementedError) return NextResponse.json({ error: error.message }, { status: 422 });
  throw error;
}

// isOwner/isAdmin은 **반드시 getPermissionSummary(권위)에서** 받는다. session.systemRole에서 직접 도출하면
// must-change·비활성 사용자의 stale JWT가 owner/admin 경로를 우회한다(D17 게이트 무력화).
export function buildTransitionCtx(u: SessionUser, summary: PermissionSummary, note?: string) {
  return { userId: u.id, isOwner: summary.isOwner, permissionKeys: new Set(summary.keys), note };
}

export function buildMailCtx(u: SessionUser, summary: PermissionSummary) {
  return { userId: u.id, isOwner: summary.isOwner, isAdmin: summary.isAdmin, permissionKeys: new Set(summary.keys) };
}

export function parseOptionalDate(v: string | null): Date | null | "invalid" {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}
