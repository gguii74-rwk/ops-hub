import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/kernel/access";
import { PageSection } from "@/components/ui/page-section";
import { BillingSettings } from "./billing-settings";

export default async function BillingSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasPermission(session.user.id, "workflows.billing", "view"))) redirect("/workflows");
  const canConfigure = await hasPermission(session.user.id, "workflows.billing", "configure");
  return (
    <PageSection title="대금청구 설정" subtitle="연도별 계약 정보와 회차 제출일을 관리합니다.">
      <BillingSettings canConfigure={canConfigure} />
    </PageSection>
  );
}
