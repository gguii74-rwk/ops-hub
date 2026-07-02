import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRecipientSets } from "@/modules/workflows/services/mail-recipients";
import { mapError } from "../../_shared";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const sets = await getRecipientSets(session.user.id);
    return NextResponse.json({ sets }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return mapError(e);
  }
}
