import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { UI_VIEWS, VIEW_PERMISSION } from "@/modules/calendar/views";
import type { ViewKey } from "@/modules/calendar/types";
import { PageSection } from "@/components/ui/page-section";
import { EmptyState } from "@/components/ui/states";
import { CalendarView } from "./calendar-view";

export default async function CalendarPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const keySet = new Set(keys);
  const allowedViews: ViewKey[] = UI_VIEWS.filter((v) => keySet.has(`${VIEW_PERMISSION[v]}:view`));

  return (
    <PageSection title="캘린더">
      {allowedViews.length === 0 ? (
        <EmptyState>표시할 캘린더 권한이 없습니다.</EmptyState>
      ) : (
        <CalendarView allowedViews={allowedViews} />
      )}
    </PageSection>
  );
}
