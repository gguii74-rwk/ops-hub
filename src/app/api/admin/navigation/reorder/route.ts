import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reorderNavigationItems } from "@/modules/admin/navigation/services";
import { reorderNavSchema } from "@/modules/admin/navigation/validations";
import { parseExpectedUpdatedAt } from "@/kernel/optimistic";
import { mapError } from "../_shared";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = reorderNavSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    // orderedItems.updatedAt(ISO) → Date 변환 후 서비스로(P6 버전 CAS). 다른 변경 경로와 동일 패턴.
    await reorderNavigationItems(session.user.id, {
      parentId: parsed.data.parentId,
      orderedItems: parsed.data.orderedItems.map((i) => ({ id: i.id, updatedAt: parseExpectedUpdatedAt(i.updatedAt) })),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
