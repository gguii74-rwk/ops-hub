import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { listMyRequests, createLeaveRequest } from "@/modules/leave/services/requests";
import { createLeaveSchema } from "@/modules/leave/validations";
import { mapError, parseStatusList } from "../_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const statuses = parseStatusList(new URL(req.url).searchParams.get("status"));
  if (statuses === "invalid") return NextResponse.json({ error: "invalid status" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "leave.request", "view");
    const items = await listMyRequests(session.user.id, statuses ?? undefined);
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
  const parsed = createLeaveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "leave.request", "create");
    const created = await createLeaveRequest(session.user.id, parsed.data);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    return mapError(error);
  }
}
