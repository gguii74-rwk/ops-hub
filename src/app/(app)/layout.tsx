import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { loadNavigation } from "@/kernel/navigation";
import { PermissionProvider } from "@/lib/auth/permissions-client";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AppNav } from "./app-nav";
import { Providers } from "./providers";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  // fail-closed: user는 있는데 id가 없는 깨진 세션(예: 다른 앱/stale 쿠키로 복호화 실패)도 미인증으로 처리.
  // id 없이 getPermissionSummary로 내려가면 prisma.findUnique({id:undefined})로 500 크래시 → 로그인으로 보낸다.
  if (!session?.user?.id) redirect("/login");
  // mustChangePassword: 임시 비번 사용자를 비밀번호 변경 페이지로 강제 전환. 변경 페이지는 (app) 밖에 있어 redirect 루프 없음.
  if (session.user.mustChangePassword) redirect("/account/password");

  const summary = await getPermissionSummary(session.user.id);
  const nav = await loadNavigation(summary.keys);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <PermissionProvider keys={summary.keys}>
      <Providers>
      <div className="grid min-h-screen grid-cols-[220px_1fr] bg-page">
        <aside className="flex flex-col gap-4 border-r border-border bg-card/95 p-4 shadow-sm shadow-slate-950/5">
          <div className="space-y-2">
            <strong className="font-display text-lg font-semibold tracking-tight">ops-hub</strong>
            <div className="h-1 w-12 rounded-full bg-brand" aria-hidden />
          </div>
          <AppNav items={nav} />
          <div className="mt-auto flex items-center justify-between">
            <form action={logout}>
              <Button type="submit" variant="ghost" size="sm">
                로그아웃
              </Button>
            </form>
            <ThemeSwitcher />
          </div>
        </aside>
        <main className="min-w-0 p-6">
          <p className="mb-4 border-b border-border pb-3 text-sm text-muted-foreground">
            {session.user.name} · {session.user.systemRole}
          </p>
          {children}
        </main>
      </div>
      </Providers>
    </PermissionProvider>
  );
}
