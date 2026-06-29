import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { billingConfigUpdateSchema } from "@/modules/workflows/validations";
import { getBillingConfig, updateBillingConfig, removeBillingConfig } from "@/modules/workflows/services/billing-config";
import { buildTransitionCtx, mapError } from "../../../_shared";

function parseYear(raw: string): number | null {
  const y = Number(raw);
  return Number.isInteger(y) ? y : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ year: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear((await params).year);
  if (year === null) return NextResponse.json({ error: "invalid year" }, { status: 400 });
  try {
    const summary = await getPermissionSummary(session.user.id);
    const dto = await getBillingConfig(buildTransitionCtx(session.user, summary), year);
    if (!dto) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(dto, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return mapError(e); }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ year: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear((await params).year);
  if (year === null) return NextResponse.json({ error: "invalid year" }, { status: 400 });
  try {
    const data = billingConfigUpdateSchema.parse(await req.json());
    const summary = await getPermissionSummary(session.user.id);
    const dto = await updateBillingConfig(buildTransitionCtx(session.user, summary), year, data);
    if (!dto) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(dto);
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ year: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const year = parseYear((await params).year);
  if (year === null) return NextResponse.json({ error: "invalid year" }, { status: 400 });
  try {
    const summary = await getPermissionSummary(session.user.id);
    const ok = await removeBillingConfig(buildTransitionCtx(session.user, summary), year);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) { return mapError(e); }
}
