import "server-only";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/kernel/access";

// 직접입력 대상 재검증: 위조 userId 거부(존재·ACTIVE). admin 권한은 **전사 글로벌**이라 부서 대조는 하지 않는다
// (결정 — spec §7: §2 "팀장 승인 흐름 없음"·원본 annual-leave와 동일). 실재·활성 대상이면 전사 대상에 작용 가능.
export async function assertTargetUser(targetUserId: string): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: targetUserId }, select: { status: true } });
  if (!u || u.status !== "ACTIVE") throw new ForbiddenError("대상 사용자가 유효하지 않습니다.");
}
