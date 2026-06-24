import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { listActiveTeamOptions } from "@/modules/admin/teams/services";
import { UsersList } from "./_components/users-list";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [{ keys: permKeys }, teams] = await Promise.all([
    getPermissionSummary(session.user.id),
    listActiveTeamOptions(),
  ]);
  const keys = new Set(permKeys);
  if (!keys.has("admin.users:view")) redirect("/dashboard");

  return (
    <UsersList
      canCreate={keys.has("admin.users:create")}
      canUpdate={keys.has("admin.users:update")}
      canApprove={keys.has("admin.users:approve")}
      teams={teams}
    />
  );
}
