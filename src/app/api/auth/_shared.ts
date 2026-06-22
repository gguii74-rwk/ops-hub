import { NextResponse } from "next/server";
import { RateLimitError, TokenError, UserConflictError, UserValidationError } from "@/modules/admin/users/errors";
import { HostMismatchError } from "@/modules/admin/users/base-url";

// 공개 auth 라우트 에러 매핑(S4). 알 수 없는 에러는 재throw(500은 Next가 처리).
export function mapAuthError(error: unknown): NextResponse {
  if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
  if (error instanceof TokenError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof UserValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof UserConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  // finding F: 신뢰할 수 없는 Host로 verify 링크를 만들 수 없을 때(토큰 생성 전 거부) — 400으로 받아
  // 라우트가 throw 대신 Response를 반환하게 한다(비밀 토큰은 어차피 메일에 실리지 않았다).
  if (error instanceof HostMismatchError) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  throw error;
}
