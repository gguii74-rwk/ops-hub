import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary, allowedScopes } from "@/kernel/access";
import { getRoleMatrix } from "@/modules/admin/roles/services";
import { MatrixEditor } from "./_components/matrix-editor";

export default async function AdminRolesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const summary = await getPermissionSummary(session.user.id);
  const canView = summary.isOwner || summary.keys.includes("admin.roles:view");
  if (!canView) redirect("/dashboard");
  const canConfigure = summary.isOwner; // configure는 OWNER 전용(D7) — 위임 admin은 read-only

  const matrix = await getRoleMatrix();
  // 각 permission의 scopeable 옵션을 서버에서 계산해 내려준다(PD2).
  const scopeOptions: Record<string, string[]> = {};
  for (const p of matrix.permissions) scopeOptions[`${p.resource}:${p.action}`] = allowedScopes(p.resource);
  return <MatrixEditor matrix={matrix} scopeOptions={scopeOptions} canConfigure={canConfigure} />;
}
