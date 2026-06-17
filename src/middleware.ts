import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/config";

export const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // api(자체 인증)·정적 자원은 미들웨어 제외. 나머지 페이지는 authorized 콜백이 판정.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
