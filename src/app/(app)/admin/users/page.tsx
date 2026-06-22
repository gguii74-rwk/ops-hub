import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { UsersList } from "./_components/users-list";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const keys = new Set((await getPermissionSummary(session.user.id)).keys);
  if (!keys.has("admin.users:view")) redirect("/dashboard");

  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">사용자 관리</h1>
      <UsersList
        canCreate={keys.has("admin.users:create")}
        canUpdate={keys.has("admin.users:update")}
        canApprove={keys.has("admin.users:approve")}
      />
    </section>
  );
}
