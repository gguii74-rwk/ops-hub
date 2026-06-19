import type { CalendarSourceProvider, ViewKey } from "./types";
import { internalLeaveProvider } from "./sources/internalLeave";
import { workflowTaskProvider } from "./sources/workflowTask";
import { manualProvider } from "./sources/manual";
import { createGoogleProvider } from "./sources/google";
import { createHolidayProvider } from "./sources/holiday";

export function createCalendarProviders(opts: { forceRefresh?: boolean; view?: ViewKey } = {}): Record<string, CalendarSourceProvider> {
  return {
    internalLeave: internalLeaveProvider,
    workflowTask: workflowTaskProvider,
    manual: manualProvider,
    google: createGoogleProvider({ forceRefresh: opts.forceRefresh, view: opts.view }), // view → personal 뷰 owner 스코프(F2)
    holiday: createHolidayProvider({ forceRefresh: opts.forceRefresh }),
  };
}
