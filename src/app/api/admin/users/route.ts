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
const EMPLOYMENT_TYPES = ["REGULAR", "CONTRACTOR"] as const;
function isEmploymentType(v: string): v is (typeof EMPLOYMENT_TYPES)[number] {
  return (EMPLOYMENT_TYPES as readonly string[]).includes(v);
}
const JOB_FUNCTIONS = ["PM", "DEVELOPER", "CONTENT_MANAGER", "CIVIL_RESPONSE"] as const;
function isJobFunction(v: string): v is (typeof JOB_FUNCTIONS)[number] {
  return (JOB_FUNCTIONS as readonly string[]).includes(v);
}
function parsePositiveInt(v: string | null, fallback: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}
const MAX_PAGE_SIZE = 100;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status");
  if (status && !isStatus(status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
  const employmentType = sp.get("employmentType");
  if (employmentType && !isEmploymentType(employmentType)) return NextResponse.json({ error: "invalid employmentType" }, { status: 400 });
  const jobFunction = sp.get("jobFunction");
  if (jobFunction && !isJobFunction(jobFunction)) return NextResponse.json({ error: "invalid jobFunction" }, { status: 400 });
  const filter = {
    status: status ? (status as Status) : undefined,
    employmentType: employmentType ?? undefined,
    jobFunction: jobFunction ?? undefined,
    q: sp.get("q") ?? undefined,
    page: parsePositiveInt(sp.get("page"), 1),
    pageSize: Math.min(parsePositiveInt(sp.get("pageSize"), 20), MAX_PAGE_SIZE),
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
