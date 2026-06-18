import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { loadNavigation } from "@/kernel/navigation";
import { PermissionProvider } from "@/lib/auth/permissions-client";

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
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", minHeight: "100vh" }}>
        <aside style={{ borderRight: "1px solid var(--border)", padding: 16 }}>
          <strong>ops-hub</strong>
          <nav style={{ display: "grid", gap: 8, marginTop: 16 }}>
            {nav.map((node) => (
              <Link key={node.key} href={node.href ?? "#"}>
                {node.label}
              </Link>
            ))}
          </nav>
          <form action={logout} style={{ marginTop: 24 }}>
            <button type="submit">로그아웃</button>
          </form>
        </aside>
        <main style={{ padding: 24 }}>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            {session.user.name} · {session.user.systemRole}
          </p>
          {children}
        </main>
      </div>
    </PermissionProvider>
  );
}
