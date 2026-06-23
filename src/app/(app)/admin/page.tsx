import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/kernel/access";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasPermission(session.user.id, "admin.users", "view"))) {
    redirect("/dashboard");
  }
  return (
    <section className="grid gap-4">
      <h1 className="text-xl font-semibold">관리</h1>
      <p className="text-sm text-muted-foreground">좌측 메뉴에서 사용자 관리·메뉴 관리를 선택하세요.</p>
    </section>
  );
}
