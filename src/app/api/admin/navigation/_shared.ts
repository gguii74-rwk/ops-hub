import { NextResponse } from "next/server";
import { ForbiddenError, getPermissionSummary } from "@/kernel/access";
import { NavigationConflictError, NavigationValidationError } from "@/modules/admin/navigation/errors";

// 읽기 게이트(view). OWNER는 키 멤버십과 무관 통과(users authorize 동형 — seed 의존 lockout 방지).
export async function authorizeView(userId: string): Promise<void> {
  const summary = await getPermissionSummary(userId);
  if (summary.isOwner) return;
  if (!summary.keys.includes("admin.navigation:view")) {
    throw new ForbiddenError("admin.navigation:view 권한이 없습니다.");
  }
}

// 도메인 에러 → HTTP. 알 수 없는 에러는 재throw(500 삼키지 않음 — users _shared 동형).
export function mapError(error: unknown): NextResponse {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof NavigationValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof NavigationConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  throw error;
}
