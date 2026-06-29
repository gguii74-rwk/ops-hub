import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { getFileForDownload } from "@/modules/workflows/services/download";
import { buildTransitionCtx, mapError } from "../../../_shared";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, fileId } = await params;
  try {
    const summary = await getPermissionSummary(session.user.id);
    const file = await getFileForDownload(buildTransitionCtx(session.user, summary), id, fileId);
    if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
    const encoded = encodeURIComponent(file.filename);
    // RFC 5987: filename*= for Korean/non-ASCII; ASCII fallback filename= for older clients
    const asciiName = file.filename.replace(/[^\x20-\x7E]/g, "_");
    return new NextResponse(file.bytes.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) { return mapError(e); }
}
