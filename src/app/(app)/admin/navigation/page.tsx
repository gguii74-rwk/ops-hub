import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { listNavigationTree, listPermissionOptions } from "@/modules/admin/navigation/services";
import type { NavigationNodeAdmin } from "@/modules/admin/navigation/repositories";
import { NavigationEditor, type NavRowDto } from "./_components/navigation-editor";

function serializeNode(n: NavigationNodeAdmin): NavRowDto {
  return {
    id: n.id, key: n.key, label: n.label, href: n.href, parentId: n.parentId,
    sortOrder: n.sortOrder, requiredPermissionId: n.requiredPermissionId, isActive: n.isActive,
    updatedAt: n.updatedAt.toISOString(),
    children: n.children.map(serializeNode),
  };
}

export default async function AdminNavigationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const summary = await getPermissionSummary(session.user.id);
  const canView = summary.isOwner || summary.keys.includes("admin.navigation:view");
  if (!canView) redirect("/dashboard");
  const canConfigure = summary.isOwner || summary.keys.includes("admin.navigation:configure");

  const [tree, permissions] = await Promise.all([listNavigationTree(), listPermissionOptions()]);
  return (
    <NavigationEditor
      tree={tree.map(serializeNode)}
      permissions={permissions}
      canConfigure={canConfigure}
    />
  );
}
