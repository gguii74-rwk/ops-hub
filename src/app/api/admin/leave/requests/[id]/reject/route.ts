import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reject } from "@/modules/leave/services/requests";
import { rejectSchema } from "@/modules/leave/validations";
import { mapError } from "@/app/api/leave/_shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    await reject(id, session.user.id, parsed.data.rejectionReason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
