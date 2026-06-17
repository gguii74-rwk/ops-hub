import type { NextAuthConfig } from "next-auth";
import "@/lib/auth/types";
import type { SessionUser } from "@/lib/auth/types";

export const authConfig: NextAuthConfig = {
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic = pathname === "/login" || pathname.startsWith("/api/auth");
      if (isPublic) return true;
      return Boolean(auth?.user);
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id as string;
        token.name = user.name ?? "";
        token.email = user.email ?? "";
        token.systemRole = user.systemRole;
        token.employmentType = user.employmentType;
        token.jobFunction = user.jobFunction;
      }
      return token;
    },
    session({ session, token }) {
      const user: SessionUser = {
        id: token.uid,
        email: token.email as string,
        name: token.name as string,
        systemRole: token.systemRole,
        employmentType: token.employmentType,
        jobFunction: token.jobFunction,
      };
      (session as unknown as { user: SessionUser }).user = user;
      return session;
    },
  },
};
