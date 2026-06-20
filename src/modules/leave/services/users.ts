import "server-only";
import { prisma } from "@/lib/prisma";

// 직접입력 대상 후보(활성 사용자). PII·target id 과노출 방지 위해 라우트는 leave.approval:approve로 가드.
export function listActiveUsers() {
  return prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, department: true, email: true },
    orderBy: { name: "asc" },
  });
}
