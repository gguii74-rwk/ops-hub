import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { previewRoles } from "@/modules/admin/navigation/services";
import { authorizeView, mapError } from "../_shared";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const permissionId = new URL(req.url).searchParams.get("permissionId");
  if (!permissionId) return NextResponse.json({ error: "permissionId required" }, { status: 400 });
  try {
    await authorizeView(session.user.id);
    const roles = await previewRoles(permissionId);
    return NextResponse.json({ roles }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return mapError(e);
  }
}
