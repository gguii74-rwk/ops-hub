import { NextResponse } from "next/server";
import { signupSchema } from "@/modules/admin/users/validations/signup";
import { extractClientIp, enforceRateLimit, SIGNUP_IP_LIMIT, SIGNUP_EMAIL_LIMIT, VERIFY_TOKEN_TTL_MS, PENDING_UNVERIFIED_CAP } from "@/modules/admin/users/rate-limit";
import { generateVerifyToken, hashToken } from "@/modules/admin/users/token";
import { buildVerifyLink } from "@/modules/admin/users/base-url";
import { createPendingSignup } from "@/modules/admin/users/repositories";
import { buildVerifyEmailMail } from "@/modules/admin/users/mail-templates";
import { triggerLeaveMailDrain } from "@/modules/leave/services/mail";
import { UserConflictError } from "@/modules/admin/users/errors";
import { mapAuthError } from "../_shared";

// 신청 접수 여부를 항상 동일 메시지로 응답 — 이메일 존재 여부가 새지 않게(D10·D18 열거 방지).
const ACCEPTED = { message: "가입 신청이 접수되었습니다. 이메일을 확인해 주세요." };

export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const input = parsed.data;
  const email = input.email.toLowerCase();

  try {
    // ── D18 사전 강제(원자적·pre-write): per-IP·per-email 한도 초과 시 User/MailDelivery 행 생성 전 429 ──
    //    (PENDING 전역 상한은 createPendingSignup 트랜잭션 안에서 검사 — 동시요청 cap 초과 방지, finding #3)
    const ip = extractClientIp(req);
    const now = new Date();
    await enforceRateLimit("signup:ip", ip, SIGNUP_IP_LIMIT, now);
    await enforceRateLimit("signup:email", email, SIGNUP_EMAIL_LIMIT, now);

    // 토큰: 평문은 메일 링크에만, DB엔 해시. 검증 메일 본문도 미리 만들어 repository에 넘긴다(같은 트랜잭션에서 enqueue).
    const plainToken = generateVerifyToken();
    const tokenHash = hashToken(plainToken);
    const tokenExpiresAt = new Date(now.getTime() + VERIFY_TOKEN_TTL_MS);
    // 링크는 요청 Host가 아니라 canonical base URL(AUTH_URL/NEXTAUTH_URL)로 생성한다(finding F).
    // 스푸핑된 Host/X-Forwarded-Host면 buildVerifyLink가 토큰을 넣기 전에 HostMismatchError를 던진다.
    const link = buildVerifyLink(req, plainToken);
    const { subject, bodyHtml } = buildVerifyEmailMail(link);

    try {
      // User 생성·만료 PENDING 교체·검증메일 enqueue·PENDING 상한 검사를 createPendingSignup이 한 트랜잭션에서 원자 처리(finding #3·#4).
      // PENDING 상한 상수는 라우트가 pendingCap 인자로 주입한다(deps 역전 방지 — repository는 rate-limit.ts를 import하지 않음).
      await createPendingSignup({
        email, name: input.name, employmentType: input.employmentType,
        jobFunction: input.jobFunction, department: input.department, tokenHash, tokenExpiresAt,
        mail: { recipients: [email], subject, bodyHtml }, pendingCap: PENDING_UNVERIFIED_CAP,
      });
    } catch (e) {
      // 중복(검증완료·활성·REJECTED·미만료 PENDING) → 열거 방지를 위해 동일 중립 응답(메일·drain 없이).
      // RateLimitError(PENDING 상한)는 여기서 흡수하지 않고 바깥 catch → mapAuthError(429)로.
      if (e instanceof UserConflictError) return NextResponse.json(ACCEPTED, { status: 202 });
      throw e;
    }

    // 메일은 트랜잭션 내에서 이미 enqueue됨 — 커밋 후 발송 트리거만(fire-and-forget).
    triggerLeaveMailDrain();
    return NextResponse.json(ACCEPTED, { status: 202 });
  } catch (error) {
    return mapAuthError(error);
  }
}
