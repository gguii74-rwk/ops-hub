import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { billingConfigSchema } from "@/modules/workflows/validations";
import { listBillingConfig, createBillingConfig } from "@/modules/workflows/services/billing-config";
import { buildTransitionCtx, mapError } from "../../_shared";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const summary = await getPermissionSummary(session.user.id);
    const items = await listBillingConfig(buildTransitionCtx(session.user, summary));
    return NextResponse.json(items, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return mapError(e); }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const data = billingConfigSchema.parse(await req.json());
    const summary = await getPermissionSummary(session.user.id);
    const created = await createBillingConfig(buildTransitionCtx(session.user, summary), data);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e);
  }
}
