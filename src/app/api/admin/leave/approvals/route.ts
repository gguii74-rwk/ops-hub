import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { listAllRequestsWithUser } from "@/modules/leave/services/requests";
import { mapError } from "@/app/api/leave/_shared";

// 승인 대기 큐 전용. leave.approval:view로 가드 — 전체 이력 권한(leave.admin:view)을 요구하지 않는다.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    await requirePermission(session.user.id, "leave.approval", "view");
    const items = await listAllRequestsWithUser({ statuses: ["PENDING"] });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
