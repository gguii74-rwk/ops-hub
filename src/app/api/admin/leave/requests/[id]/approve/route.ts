import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { approve } from "@/modules/leave/services/requests";
import { mapError } from "@/app/api/leave/_shared";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    await approve(id, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
