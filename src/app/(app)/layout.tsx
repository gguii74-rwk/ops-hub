import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { loadNavigation } from "@/kernel/navigation";
import { PermissionProvider } from "@/lib/auth/permissions-client";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const summary = await getPermissionSummary(session.user.id);
  const nav = await loadNavigation(summary.keys);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <PermissionProvider keys={summary.keys}>
      <div className="grid min-h-screen grid-cols-[200px_1fr]">
        <aside className="flex flex-col gap-4 border-r border-border bg-card p-4">
          <strong className="text-sm font-semibold">ops-hub</strong>
          <nav className="grid gap-1">
            {nav.map((node) => (
              <Link
                key={node.key}
                href={node.href ?? "#"}
                className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {node.label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto flex items-center justify-between">
            <form action={logout}>
              <Button type="submit" variant="ghost" size="sm">
                로그아웃
              </Button>
            </form>
            <ThemeSwitcher />
          </div>
        </aside>
        <main className="p-6">
          <p className="mb-4 text-sm text-muted-foreground">
            {session.user.name} · {session.user.systemRole}
          </p>
          {children}
        </main>
      </div>
    </PermissionProvider>
  );
}
