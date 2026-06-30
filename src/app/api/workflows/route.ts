import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { getTaskList } from "@/modules/workflows/services/tasks";
import { createTask } from "@/modules/workflows/services/lifecycle";
import { createTaskSchema, parseStatusList } from "@/modules/workflows/validations";
import { buildTransitionCtx, mapError, parseOptionalDate } from "./_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  let statuses;
  if (statusParam) {
    statuses = parseStatusList(statusParam);
    if (!statuses) return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  const start = parseOptionalDate(url.searchParams.get("start"));
  const end = parseOptionalDate(url.searchParams.get("end"));
  if (start === "invalid" || end === "invalid") return NextResponse.json({ error: "invalid range" }, { status: 400 });

  try {
    const summary = await getPermissionSummary(session.user.id);
    const items = await getTaskList(
      { permissionKeys: new Set(summary.keys) },
      { statuses, start: start ?? undefined, end: end ?? undefined },
    );
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const scheduledAt = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) return NextResponse.json({ error: "invalid scheduledAt" }, { status: 400 });

  try {
    const summary = await getPermissionSummary(session.user.id);
    const { id } = await createTask(
      { kind: parsed.data.kind, scheduledAt },
      buildTransitionCtx(session.user, summary),
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return mapError(error);
  }
}
