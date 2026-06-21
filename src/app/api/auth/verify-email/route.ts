import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { setPasswordSchema } from "@/modules/admin/users/validations/signup";
import { hashToken } from "@/modules/admin/users/token";
import { setPasswordViaToken } from "@/modules/admin/users/repositories";
import { TokenError } from "@/modules/admin/users/errors";
import { mapAuthError } from "../_shared";

// GET: 폼 렌더 전 토큰 유효성 확인(만료·존재). 해시로 조회 — 평문 토큰을 DB와 직접 비교하지 않는다.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });
  const tokenHash = hashToken(token);
  const user = await prisma.user.findFirst({
    where: { emailVerifyTokenHash: tokenHash, emailVerifyExpiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "유효하지 않거나 만료된 링크입니다." }, { status: 400 });
  return NextResponse.json({ valid: true }, { headers: { "Cache-Control": "no-store" } });
}

// POST: 토큰+새 비번 → passwordHash(bcrypt 10)+emailVerifiedAt 기록(setPasswordViaToken). PENDING 유지(승인 전 로그인 불가).
export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = setPasswordSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    const tokenHash = hashToken(parsed.data.token);
    const passwordHash = await bcrypt.hash(parsed.data.password, 10); // seed.ts와 동일 cost
    const result = await setPasswordViaToken(tokenHash, passwordHash, new Date());
    if (!result) throw new TokenError("유효하지 않거나 만료된 링크입니다.");
    return NextResponse.json({ message: "비밀번호가 설정되었습니다. 관리자 승인 후 로그인할 수 있습니다." });
  } catch (error) {
    return mapAuthError(error);
  }
}
