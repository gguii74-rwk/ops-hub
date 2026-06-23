import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listApprovalQueue } from "@/modules/leave/services/requests";
import { mapError } from "@/app/api/leave/_shared";

// 승인 대기 큐 전용. scope 인식: all-scope는 전체, team-scope는 자기 팀만. listApprovalQueue가 내부에서 검사.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const items = await listApprovalQueue(session.user.id);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
