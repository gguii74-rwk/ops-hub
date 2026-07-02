import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { mailContactUpdateSchema } from "@/modules/workflows/validations";
import { editMailContact, removeMailContact } from "@/modules/workflows/services/mail-recipients";
import { mapError } from "../../../_shared";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    // D15: email 불변 — strictObject라 email 포함 body는 ZodError → 400.
    const input = mailContactUpdateSchema.parse(await req.json());
    const contact = await editMailContact(session.user.id, id, input);
    if (!contact) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ contact });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    const ok = await removeMailContact(session.user.id, id); // 세트 잔존 email 무관(D12)
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
