import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/kernel/access";
import { listSettings } from "@/kernel/settings";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  try {
    const items = await listSettings(session.user.id);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
