import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listNavigationTree, createNavigationItem } from "@/modules/admin/navigation/services";
import { createNavSchema } from "@/modules/admin/navigation/validations";
import { authorizeView, mapError } from "./_shared";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    await authorizeView(session.user.id);
    const tree = await listNavigationTree();
    return NextResponse.json(tree, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return mapError(e);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = createNavSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    const created = await createNavigationItem(session.user.id, parsed.data);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (e) {
    return mapError(e);
  }
}
