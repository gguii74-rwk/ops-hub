import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ keys: [] }, { status: 401 });
  }
  const summary = await getPermissionSummary(session.user.id);
  return NextResponse.json(summary);
}
