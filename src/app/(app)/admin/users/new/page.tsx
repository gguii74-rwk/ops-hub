import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { CreateUserForm } from "./_components/create-user-form";

export default async function NewUserPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const keys = new Set((await getPermissionSummary(session.user.id)).keys);
  if (!keys.has("admin.users:create")) redirect("/admin/users");

  return (
    <section className="mx-auto w-full max-w-lg space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">사용자 직접 추가</h1>
      <CreateUserForm />
    </section>
  );
}
