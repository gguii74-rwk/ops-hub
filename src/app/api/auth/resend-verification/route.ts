import { NextResponse } from "next/server";
import { resendSchema } from "@/modules/admin/users/validations/signup";
import { enforceResendCooldown, VERIFY_TOKEN_TTL_MS } from "@/modules/admin/users/rate-limit";
import { generateVerifyToken, hashToken } from "@/modules/admin/users/token";
import { buildVerifyLink } from "@/modules/admin/users/base-url";
import { refreshVerifyToken } from "@/modules/admin/users/repositories";
import { buildVerifyEmailMail } from "@/modules/admin/users/mail-templates";
import { triggerLeaveMailDrain } from "@/modules/leave/services/mail";
import { mapAuthError } from "../_shared";

const ACCEPTED = { message: "해당 이메일로 인증 메일을 재발송했습니다(가입 신청이 있는 경우)." };

export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = resendSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();

  try {
    const now = new Date();
    await enforceResendCooldown(email, now); // 쿨다운 위반은 429(사전)

    const plainToken = generateVerifyToken();
    const tokenHash = hashToken(plainToken);
    const tokenExpiresAt = new Date(now.getTime() + VERIFY_TOKEN_TTL_MS);
    // 링크는 canonical base URL로 생성·스푸핑 Host 거부(finding F) — signup과 동일 헬퍼.
    // 공개 resend는 공격자가 피해자 이메일로 호출할 수 있어 host 스푸핑 차단이 특히 중요하다.
    const link = buildVerifyLink(req, plainToken);
    const { subject, bodyHtml } = buildVerifyEmailMail(link);

    // 미검증 PENDING만 토큰 갱신 + 검증메일 재enqueue(repository가 같은 트랜잭션에서 원자 처리).
    // 대상 없으면 null → 메일·drain 없이 동일 중립 응답(열거 방지).
    const target = await refreshVerifyToken(email, tokenHash, tokenExpiresAt, { recipients: [email], subject, bodyHtml });
    if (target) triggerLeaveMailDrain();
    return NextResponse.json(ACCEPTED, { status: 202 });
  } catch (error) {
    return mapAuthError(error);
  }
}
