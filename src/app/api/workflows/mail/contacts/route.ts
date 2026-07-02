import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { mailContactCreateSchema } from "@/modules/workflows/validations";
import { addMailContact, listMailContacts } from "@/modules/workflows/services/mail-recipients";
import { mapError } from "../../_shared";

// 게이트는 서비스가 강제(D6 교집합, ForbiddenError) — 라우트는 401 + mapError(403/409)만.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const contacts = await listMailContacts(session.user.id);
    return NextResponse.json({ contacts }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return mapError(e);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const input = mailContactCreateSchema.parse(await req.json());
    const contact = await addMailContact(session.user.id, input);
    return NextResponse.json({ contact }, { status: 201 });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e); // ForbiddenError → 403, ConflictError(email 유니크) → 409
  }
}
