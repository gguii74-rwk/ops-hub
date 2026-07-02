import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { runSend } from "@/modules/workflows/services/send";
import { buildTransitionCtx, mapError } from "../../_shared";

// step ∈ {1,2}만 허용(3은 zod 거부 — F2). recipients=to(선택, 미지정 시 type[step] 폴백 — D5). cc/bcc 선택(D14는 응답측).
const sendSchema = z.object({
  step: z.union([z.literal(1), z.literal(2)]),
  subject: z.string().min(1),
  body: z.string(),
  recipients: z.array(z.string().email()).optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    const input = sendSchema.parse(await req.json());
    const summary = await getPermissionSummary(session.user.id);
    await runSend(id, input, buildTransitionCtx(session.user, summary));
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e);
  }
}
