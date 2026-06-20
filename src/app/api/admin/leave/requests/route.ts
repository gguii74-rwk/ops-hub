import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { listAllRequestsWithUser, createLeaveRequestByAdmin } from "@/modules/leave/services/requests";
import { adminCreateLeaveSchema } from "@/modules/leave/validations";
import { mapError, parseStatusList } from "@/app/api/leave/_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(req.url);
  const statuses = parseStatusList(url.searchParams.get("status"));
  if (statuses === "invalid") return NextResponse.json({ error: "invalid status" }, { status: 400 });
  const userId = url.searchParams.get("userId") ?? undefined;
  try {
    await requirePermission(session.user.id, "leave.admin", "view");
    const items = await listAllRequestsWithUser({ userId, statuses: statuses ?? undefined });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = adminCreateLeaveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const { userId, sendNotification, ...input } = parsed.data;
  try {
    await requirePermission(session.user.id, "leave.approval", "approve"); // 직접입력은 자동 승인 → approve 권한
    const created = await createLeaveRequestByAdmin(session.user.id, userId, input, null, sendNotification);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    return mapError(error);
  }
}
