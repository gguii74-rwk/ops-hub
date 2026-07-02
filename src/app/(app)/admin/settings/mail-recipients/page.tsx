import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canManageMailRecipients } from "@/modules/workflows/services/mail-recipients";
import { PageSection } from "@/components/ui/page-section";
import { MailRecipients } from "./mail-recipients";

export default async function MailRecipientsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // D6 교집합 — 관리 API와 동일 키(접근제어 규칙①). 불충족이면 설정 목록으로.
  if (!(await canManageMailRecipients(session.user.id))) redirect("/admin/settings");
  return (
    <PageSection title="메일 수신자" subtitle="주소록과 업무유형×발송단계별 기본 수신자 세트를 관리합니다.">
      <MailRecipients />
    </PageSection>
  );
}
