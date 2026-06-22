import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { UserEdit } from "./_components/user-edit";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const keys = new Set((await getPermissionSummary(session.user.id)).keys);
  if (!keys.has("admin.users:view")) redirect("/dashboard");
  const { id } = await params;

  return (
    <section className="mx-auto w-full max-w-2xl space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">사용자 편집</h1>
      <UserEdit userId={id} canUpdate={keys.has("admin.users:update")} />
    </section>
  );
}
