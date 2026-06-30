import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { getDirectoryZip } from "@/modules/workflows/services/download";
import { buildTransitionCtx, mapError } from "../../_shared";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    const summary = await getPermissionSummary(session.user.id);
    const zip = await getDirectoryZip(buildTransitionCtx(session.user, summary), id);
    if (!zip) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new NextResponse(zip.bytes.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zip.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) { return mapError(e); }
}
