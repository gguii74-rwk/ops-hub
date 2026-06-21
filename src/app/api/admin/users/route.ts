import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary, requirePermission } from "@/kernel/access";
import { listUsersForView, createUserByAdmin } from "@/modules/admin/users/services";
import { adminCreateSchema } from "@/modules/admin/users/validations";
import { buildActorCtx, mapError } from "./_shared";

const STATUSES = ["PENDING", "INVITED", "ACTIVE", "DISABLED", "REJECTED"] as const;
type Status = (typeof STATUSES)[number];
function isStatus(v: string): v is Status {
  return (STATUSES as readonly string[]).includes(v);
}
function parsePositiveInt(v: string | null, fallback: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status");
  if (status && !isStatus(status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
  const filter = {
    status: status ? (status as Status) : undefined,
    employmentType: sp.get("employmentType") ?? undefined,
    jobFunction: sp.get("jobFunction") ?? undefined,
    q: sp.get("q") ?? undefined,
    page: parsePositiveInt(sp.get("page"), 1),
    pageSize: parsePositiveInt(sp.get("pageSize"), 20),
  };
  try {
    await requirePermission(session.user.id, "admin.users", "view");
    const summary = await getPermissionSummary(session.user.id);
    const result = await listUsersForView(buildActorCtx(session.user, summary), filter);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = adminCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await requirePermission(session.user.id, "admin.users", "create");
    const summary = await getPermissionSummary(session.user.id);
    const created = await createUserByAdmin(buildActorCtx(session.user, summary), parsed.data);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    return mapError(error);
  }
}
