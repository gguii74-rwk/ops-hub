import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { listTeamsForAdmin, listActiveUsersWithTeam } from "@/modules/admin/teams/services";
import { TeamsEditor } from "./_components/teams-editor";

export default async function AdminTeamsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const summary = await getPermissionSummary(session.user.id);
  const canView = summary.isOwner || summary.keys.includes("admin.teams:view");
  if (!canView) redirect("/dashboard");
  const canConfigure = summary.isOwner || summary.keys.includes("admin.teams:configure");

  const [teams, users] = await Promise.all([listTeamsForAdmin(), listActiveUsersWithTeam()]);
  return (
    <TeamsEditor
      teams={teams.map((t) => ({ ...t, updatedAt: t.updatedAt.toISOString() }))}
      users={users}
      canConfigure={canConfigure}
    />
  );
}
