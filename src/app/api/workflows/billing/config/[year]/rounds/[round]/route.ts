import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { billingRoundDateUpdateSchema } from "@/modules/workflows/validations";
import { saveRoundDate, removeRoundDate } from "@/modules/workflows/services/billing-config";
import { buildTransitionCtx, mapError } from "../../../../../_shared";

function parsePair(yearRaw: string, roundRaw: string): { year: number; round: number } | null {
  const year = Number(yearRaw);
  const round = Number(roundRaw);
  if (!Number.isInteger(year) || !Number.isInteger(round) || round < 1 || round > 12) return null;
  return { year, round };
}

export async function PUT(req: Request, { params }: { params: Promise<{ year: string; round: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const p = await params;
  const pair = parsePair(p.year, p.round);
  if (!pair) return NextResponse.json({ error: "invalid year/round" }, { status: 400 });
  try {
    const { submitDate } = billingRoundDateUpdateSchema.parse(await req.json());
    const summary = await getPermissionSummary(session.user.id);
    const dto = await saveRoundDate(buildTransitionCtx(session.user, summary), pair.year, pair.round, new Date(submitDate));
    return NextResponse.json(dto);
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ year: string; round: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const p = await params;
  const pair = parsePair(p.year, p.round);
  if (!pair) return NextResponse.json({ error: "invalid year/round" }, { status: 400 });
  try {
    const summary = await getPermissionSummary(session.user.id);
    const ok = await removeRoundDate(buildTransitionCtx(session.user, summary), pair.year, pair.round);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) { return mapError(e); }
}
