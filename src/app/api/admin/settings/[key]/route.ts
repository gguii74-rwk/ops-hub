import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError, requirePermission } from "@/kernel/access";
import { setSetting } from "@/kernel/settings";
import { getEntry } from "@/kernel/settings/catalog";
import {
  SettingActorRequiredError,
  SettingConcurrencyError,
  SettingNotWritableError,
  SettingValidationError,
  UnknownSettingError,
} from "@/kernel/settings/registry";

export async function PUT(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { key } = await params;
  const uid = session.user.id;

  // base admin 게이트를 키 조회(getEntry) 전에 — 비관리자가 403/404 차이로 server-only 카탈로그 키(secret.* 포함)를 enumerate하지 못하게(Codex 3차 F5).
  try {
    await requirePermission(uid, "admin.settings", "configure");
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const entry = getEntry(key);
  if (!entry) {
    return NextResponse.json({ error: `unknown setting: ${key}` }, { status: 404 });
  }

  try {
    await requirePermission(uid, entry.permission.resource, entry.permission.action);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { value, expectedUpdatedAt: rawToken } = body as { value: unknown; expectedUpdatedAt?: unknown };

  // 동시성 토큰은 공개 라우트에서 필수: 명시적 null(최초 생성) 또는 유효 ISO 문자열만 허용.
  // 생략(undefined)은 service의 last-write-wins 경로로 떨어져 409 가드를 우회하므로 400으로 거부(Codex 2차 리뷰 F3).
  let expectedUpdatedAt: Date | null;
  if (rawToken === null) {
    expectedUpdatedAt = null;
  } else if (typeof rawToken === "string") {
    const parsed = new Date(rawToken);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "invalid expectedUpdatedAt" }, { status: 400 });
    }
    expectedUpdatedAt = parsed;
  } else {
    return NextResponse.json({ error: "expectedUpdatedAt required (null or ISO string)" }, { status: 400 });
  }

  try {
    const result = await setSetting(key, value, { actorId: uid, expectedUpdatedAt });
    return NextResponse.json({ updatedAt: result.updatedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UnknownSettingError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof SettingNotWritableError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SettingValidationError) return NextResponse.json({ error: error.message }, { status: 422 });
    if (error instanceof SettingConcurrencyError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof SettingActorRequiredError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
