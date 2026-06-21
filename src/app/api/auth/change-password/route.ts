import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { changePasswordTx } from "@/modules/admin/users/repositories";
import { UserConflictError } from "@/modules/admin/users/errors";
import { changePasswordSchema } from "@/modules/admin/users/validations/change-password";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const { currentPassword, newPassword } = parsed.data;

  const userId = session.user.id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  // 자가가입 미설정·비활성 등 passwordHash 없으면 변경 경로 불가(세션 콜백이 이미 무효화하지만 방어적으로).
  if (!user?.passwordHash) return NextResponse.json({ error: "비밀번호를 변경할 수 없습니다." }, { status: 400 });

  // D15: 자발 변경·강제(임시 비번) 변경 모두 현재 비밀번호 확인을 요구한다(우회 금지).
  if (!currentPassword) return NextResponse.json({ error: "현재 비밀번호를 입력해 주세요." }, { status: 400 });
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return NextResponse.json({ error: "현재 비밀번호가 일치하지 않습니다." }, { status: 400 });

  // D15 강화: 새 비밀번호가 현재 비밀번호와 같으면 거부한다. 강제변경(must-change) 사용자가 관리자 발급 임시 비번을
  // 양쪽에 그대로 제출해 mustChangePassword만 해제하고 알려진 임시 비번을 영구 비번으로 굳히는 우회를 차단한다.
  // currentPassword는 위에서 저장 해시와 일치 검증됨 → 평문 동등 비교가 곧 "현재 비번 재사용" 판정.
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "새 비밀번호는 현재 비밀번호와 달라야 합니다." }, { status: 400 });
  }

  try {
    const newHash = await bcrypt.hash(newPassword, 10);
    // S6: passwordHash + passwordChangedAt=now + mustChangePassword=false (타 세션 무효화 기준 = passwordChangedAt).
    // finding 4: 방금 검증에 쓴 현재 해시(user.passwordHash)를 expectedCurrentHash로 넘긴다 — 검증~쓰기 사이에 admin reset가
    // 끼면 CAS 불일치(count 0)로 UserConflictError → 409(아래) → 사용자는 재로그인. 이전 비번이 reset/must-change를 덮어쓰지 못함.
    await changePasswordTx(userId, newHash, new Date(), user.passwordHash);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
