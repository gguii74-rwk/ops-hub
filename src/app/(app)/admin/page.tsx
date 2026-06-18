import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/kernel/access";
import { AdminLinks } from "./admin-links";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasPermission(session.user.id, "admin.users", "view"))) {
    redirect("/dashboard");
  }
  return (
    <section className="grid gap-4">
      <h1 className="text-xl font-semibold">관리</h1>
      <AdminLinks />
    </section>
  );
}
