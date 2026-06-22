import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateNavigationItem, deleteNavigationItem } from "@/modules/admin/navigation/services";
import { updateNavBodySchema, deleteNavBodySchema } from "@/modules/admin/navigation/validations";
import { parseExpectedUpdatedAt } from "@/kernel/optimistic";
import { mapError } from "../_shared";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = updateNavBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const { updatedAt, ...patch } = parsed.data;
  // updatedAt은 낙관락 메타 — patch 카운트에서 제외. 실제 patch 0개면 거부(상태 안 바뀐 200 방지).
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "empty patch" }, { status: 400 });
  try {
    await updateNavigationItem(session.user.id, id, patch, parseExpectedUpdatedAt(updatedAt));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = deleteNavBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    // confirmedChildIds(P9): 클라가 확인 화면에서 본 자식 집합 — 서비스가 현재 DB 집합과 대조(cascade TOCTOU 차단).
    await deleteNavigationItem(session.user.id, id, parseExpectedUpdatedAt(parsed.data.updatedAt), parsed.data.confirmedChildIds);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
