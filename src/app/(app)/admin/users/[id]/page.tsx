import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { listActiveTeamOptions } from "@/modules/admin/teams/services";
import { PageSection } from "@/components/ui/page-section";
import { UserEdit } from "./_components/user-edit";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [{ keys: permKeys }, teams, { id }] = await Promise.all([
    getPermissionSummary(session.user.id),
    listActiveTeamOptions(),
    params,
  ]);
  const keys = new Set(permKeys);
  if (!keys.has("admin.users:view")) redirect("/dashboard");

  return (
    <PageSection title="사용자 편집" width="wide">
      <UserEdit userId={id} canUpdate={keys.has("admin.users:update")} teams={teams} />
    </PageSection>
  );
}
