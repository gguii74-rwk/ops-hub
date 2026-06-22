import { NextResponse } from "next/server";
import type { LeaveRequestStatus } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import type { PermissionSummary } from "@/kernel/access";
import { LeaveConflictError, LeaveValidationError } from "@/modules/leave/errors";
import type { SessionUser } from "@/lib/auth/types";

export function mapError(error: unknown): NextResponse {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof LeaveConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof LeaveValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  throw error;
}

// isOwner는 **getPermissionSummary(권위)에서** 받는다. session.systemRole 직접 도출은 must-change·비활성 stale JWT의 우회를 허용(D17 무력화).
export function buildLeaveCtx(u: SessionUser, summary: PermissionSummary) {
  return { userId: u.id, isOwner: summary.isOwner, permissionKeys: new Set(summary.keys) };
}

/** KST 현재 연도 기준 기본값. */
export function parseYear(v: string | null): number {
  const n = v ? Number(v) : NaN;
  if (Number.isInteger(n) && n >= 2000 && n <= 2100) return n;
  return new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

const ALL: LeaveRequestStatus[] = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
export function parseStatusList(v: string | null): LeaveRequestStatus[] | null | "invalid" {
  if (!v) return null;
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.some((p) => !ALL.includes(p as LeaveRequestStatus))) return "invalid";
  return parts as LeaveRequestStatus[];
}
