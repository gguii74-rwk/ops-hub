import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { listActiveTeamOptions } from "@/modules/admin/teams/services";
import { PageSection } from "@/components/ui/page-section";
import { CreateUserForm } from "./_components/create-user-form";

export default async function NewUserPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [{ keys: permKeys }, teams] = await Promise.all([
    getPermissionSummary(session.user.id),
    listActiveTeamOptions(),
  ]);
  const keys = new Set(permKeys);
  if (!keys.has("admin.users:create")) redirect("/admin/users");

  return (
    <PageSection title="사용자 직접 추가" width="form">
      <CreateUserForm teams={teams} />
    </PageSection>
  );
}
