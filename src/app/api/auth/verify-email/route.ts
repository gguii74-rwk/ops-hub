import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { setPasswordSchema } from "@/modules/admin/users/validations/signup";
import { hashToken } from "@/modules/admin/users/token";
import { setPasswordViaToken } from "@/modules/admin/users/repositories";
import { TokenError } from "@/modules/admin/users/errors";
import { extractClientIp, enforceRateLimit, SIGNUP_IP_LIMIT } from "@/modules/admin/users/rate-limit";
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
// D18: per-IP 레이트리밋 → 토큰 존재 선검사(cheap) → bcrypt → atomic update(race 방어).
export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = setPasswordSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    // 1. per-IP 레이트리밋(bcrypt 전 — unauthenticated bcrypt DoS 차단)
    const ip = extractClientIp(req);
    const now = new Date();
    await enforceRateLimit("set-password:ip", ip, SIGNUP_IP_LIMIT, now);

    // 2. 토큰 해시 계산
    const tokenHash = hashToken(parsed.data.token);

    // 3. bcrypt 전 토큰 존재·미만료 선검사(forged/expired 토큰으로 bcrypt-CPU 소비 차단)
    const exists = await prisma.user.findFirst({
      where: { emailVerifyTokenHash: tokenHash, emailVerifyExpiresAt: { gt: now }, status: "PENDING", emailVerifiedAt: null },
      select: { id: true },
    });
    if (!exists) throw new TokenError("유효하지 않거나 만료된 링크입니다.");

    // 4. 검증 통과 → bcrypt(CPU 소비) → atomic update
    const passwordHash = await bcrypt.hash(parsed.data.password, 10); // seed.ts와 동일 cost
    const result = await setPasswordViaToken(tokenHash, passwordHash, now);
    // 선검사 통과 후 다른 요청이 토큰을 소비한 race 처리
    if (!result) throw new TokenError("유효하지 않거나 만료된 링크입니다.");
    return NextResponse.json({ message: "비밀번호가 설정되었습니다. 관리자 승인 후 로그인할 수 있습니다." });
  } catch (error) {
    return mapAuthError(error);
  }
}
