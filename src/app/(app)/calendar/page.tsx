import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { UI_VIEWS, VIEW_PERMISSION } from "@/modules/calendar/views";
import type { ViewKey } from "@/modules/calendar/types";
import { CalendarView } from "./calendar-view";

export default async function CalendarPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const keySet = new Set(keys);
  const allowedViews: ViewKey[] = UI_VIEWS.filter((v) => keySet.has(`${VIEW_PERMISSION[v]}:view`));

  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">캘린더</h1>
      {allowedViews.length === 0 ? (
        <p className="text-sm text-muted-foreground">표시할 캘린더 권한이 없습니다.</p>
      ) : (
        <CalendarView allowedViews={allowedViews} />
      )}
    </section>
  );
}
