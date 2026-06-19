import { auth } from "@/lib/auth";
import { WorkflowDetail } from "./workflow-detail";

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const role = session?.user?.systemRole;
  const isAdmin = role === "OWNER" || role === "ADMIN";
  return <WorkflowDetail taskId={id} isAdmin={isAdmin} />;
}
