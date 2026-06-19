import { NextResponse } from "next/server";
import { ForbiddenError } from "@/kernel/access";
import { ConflictError } from "@/modules/workflows/types";
import type { SessionUser } from "@/lib/auth/types";

// 알려진 도메인 에러만 상태로 매핑. 그 외는 rethrow(Next가 500).
export function mapError(error: unknown): NextResponse {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof ConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  throw error;
}

export function buildTransitionCtx(u: SessionUser, keys: string[], note?: string) {
  return { userId: u.id, isOwner: u.systemRole === "OWNER", permissionKeys: new Set(keys), note };
}

export function buildMailCtx(u: SessionUser, keys: string[]) {
  const isOwner = u.systemRole === "OWNER";
  return { userId: u.id, isOwner, isAdmin: isOwner || u.systemRole === "ADMIN", permissionKeys: new Set(keys) };
}

export function parseOptionalDate(v: string | null): Date | null | "invalid" {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}
